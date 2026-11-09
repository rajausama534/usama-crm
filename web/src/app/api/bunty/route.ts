// Bunty chat. The Claude API key lives only here on the server (ANTHROPIC_API_KEY); the browser never sees it.
// Claude only gets the fixed tools in lib/bunty — never raw database access — and every tool runs with the asking
// person's own Supabase token, so Row Level Security applies to Bunty exactly as to the person.
//
// Protocol (newline-delimited JSON back to the browser):
//   {t:"state", s:"thinking"|"working"}  {t:"text", d}  {t:"tool", label}
//   {t:"confirm", cards:[{id, tool, card}], pending}   → the browser shows confirm cards, then POSTs decisions
//   {t:"done", history}  {t:"error", message}

import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaMessageParam, BetaTool, BetaToolResultBlockParam, BetaToolUseBlock, BetaContentBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { buntyContext, HttpError, logBuntyAction } from "@/lib/bunty/server";
import { findTool, toolsFor } from "@/lib/bunty/registry";
import { SYSTEM_PROMPT } from "@/lib/bunty/prompt";
import { validateInput } from "@/lib/bunty/validate";
import { ToolError, type BuntyCtx, type ConfirmCard } from "@/lib/bunty/types";
import { nowDubaiText } from "@/lib/bunty/util";
import { ROLE_LABEL } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MODEL = process.env.BUNTY_MODEL || "claude-opus-5-5";
const EFFORT = (process.env.BUNTY_EFFORT || "medium") as "low" | "medium" | "high";
const MAX_STEPS = 10;

const TOOL_DEFS: BetaTool[] = toolsFor().map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));

type Pending = { results: BetaToolResultBlockParam[] };
type Body = { history?: BetaMessageParam[]; message?: string; pending?: Pending; decisions?: Record<string, boolean> };
type Emit = (ev: Record<string, unknown>) => void;

const LABEL: Record<string, string> = {
  search_leads: "Looking through leads", get_lead: "Opening the lead", search_owners: "Searching owners", get_owner: "Opening the owner record",
  list_events: "Checking the calendar", list_approvals: "Checking approvals", get_company_overview: "Pulling company numbers", list_staff: "Checking staff",
};

export async function POST(req: Request) {
  let ctx: BuntyCtx;
  try { ctx = await buntyContext(req); }
  catch (e) { return Response.json({ error: (e as Error).message }, { status: e instanceof HttpError ? e.status : 500 }); }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "Bunty's Claude API key is not set yet (ANTHROPIC_API_KEY on the server)." }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const history: BetaMessageParam[] = Array.isArray(body.history) ? body.history.slice(-120) : [];

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const emit: Emit = (ev) => controller.enqueue(enc.encode(JSON.stringify(ev) + "\n"));
      try {
        if (body.decisions) {
          const results = await runDecisions(ctx, history, body.pending, body.decisions, emit);
          history.push({ role: "user", content: results });
        } else {
          const text = String(body.message || "").slice(0, 4000).trim();
          if (!text) throw new ToolError("Empty message");
          history.push({
            role: "user",
            content: [{ type: "text", text: `<context>Now: ${nowDubaiText()} (Dubai). Asking: ${ctx.me.name} <${ctx.me.email}>, ${ROLE_LABEL[ctx.me.role]}.</context>\n\n${text}` }],
          });
        }
        await loop(ctx, history, emit);
      } catch (e) {
        console.error("bunty:", e);
        emit({ t: "error", message: friendly(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}

const client = new Anthropic();

async function loop(ctx: BuntyCtx, history: BetaMessageParam[], emit: Emit) {
  for (let step = 0; step < MAX_STEPS; step++) {
    emit({ t: "state", s: "thinking" });
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: EFFORT },
      cache_control: { type: "ephemeral" },
      system: SYSTEM_PROMPT,
      tools: TOOL_DEFS,
      messages: history,
    });
    stream.on("text", (d) => emit({ t: "text", d }));
    const msg = await stream.finalMessage();
    history.push({ role: "assistant", content: msg.content } as unknown as BetaMessageParam);

    if (msg.stop_reason === "refusal") { emit({ t: "text", d: "\n\nSorry — I can't help with that one." }); break; }
    if (msg.stop_reason === "pause_turn") continue;
    const uses = msg.content.filter((b): b is BetaToolUseBlock => b.type === "tool_use");
    if (!uses.length || msg.stop_reason !== "tool_use") break;

    // Reads run now (in parallel); writes wait for the person's confirm.
    emit({ t: "state", s: "working" });
    const reads = uses.filter((u) => findTool(u.name)?.kind === "read");
    const writes = uses.filter((u) => findTool(u.name)?.kind === "write");
    const unknown = uses.filter((u) => !findTool(u.name));
    for (const u of reads) emit({ t: "tool", label: LABEL[u.name] || "Looking it up" });
    const results: BetaToolResultBlockParam[] = [
      ...(await Promise.all(reads.map((u) => runTool(ctx, u)))),
      ...unknown.map((u) => errResult(u.id, `No tool called ${u.name}`)),
    ];

    if (writes.length) {
      const cards: { id: string; tool: string; card: ConfirmCard }[] = [];
      for (const u of writes) {
        const tool = findTool(u.name)!;
        const v = validateInput(tool.input_schema, u.input);
        if (!v.ok) { results.push(errResult(u.id, v.error)); continue; }
        try { cards.push({ id: u.id, tool: u.name, card: await tool.preview!(ctx, v.value as never) }); }
        catch (e) { results.push(errResult(u.id, friendly(e))); }
      }
      if (cards.length) {
        emit({ t: "confirm", cards, pending: { results } satisfies Pending, history });
        return;
      }
    }
    history.push({ role: "user", content: order(uses, results) });
  }
  emit({ t: "done", history });
}

async function runDecisions(ctx: BuntyCtx, history: BetaMessageParam[], pending: Pending | undefined, decisions: Record<string, boolean>, emit: Emit) {
  const last = history[history.length - 1];
  if (!last || last.role !== "assistant" || !Array.isArray(last.content)) throw new ToolError("Nothing is waiting for a confirm.");
  const uses = (last.content as BetaContentBlock[]).filter((b): b is BetaToolUseBlock => b.type === "tool_use");
  const results = [...(pending?.results || [])].filter((r) => uses.some((u) => u.id === r.tool_use_id));
  emit({ t: "state", s: "working" });
  for (const u of uses) {
    if (results.some((r) => r.tool_use_id === u.id)) continue;
    const tool = findTool(u.name);
    if (!tool) { results.push(errResult(u.id, "Unknown tool")); continue; }
    if (tool.kind === "read") { results.push(await runTool(ctx, u)); continue; }
    if (decisions[u.id] !== true) {
      results.push({ type: "tool_result", tool_use_id: u.id, content: `${ctx.me.name} pressed Cancel. Nothing was changed. Do not retry unless asked.` });
      continue;
    }
    emit({ t: "tool", label: "Saving" });
    results.push(await runTool(ctx, u));
  }
  return order(uses, results);
}

async function runTool(ctx: BuntyCtx, u: BetaToolUseBlock): Promise<BetaToolResultBlockParam> {
  const tool = findTool(u.name)!;
  const v = validateInput(tool.input_schema, u.input);
  if (!v.ok) return errResult(u.id, v.error);
  try {
    const out = await tool.run(ctx, v.value as never);
    if (tool.kind === "write") await logBuntyAction(ctx, { tool: u.name, input: v.value, ok: true, result: out });
    return { type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out ?? null).slice(0, 60000) };
  } catch (e) {
    if (tool.kind === "write") await logBuntyAction(ctx, { tool: u.name, input: v.value, ok: false, error: friendly(e) });
    return errResult(u.id, friendly(e));
  }
}

const errResult = (id: string, message: string): BetaToolResultBlockParam => ({ type: "tool_result", tool_use_id: id, is_error: true, content: message });
const order = (uses: BetaToolUseBlock[], results: BetaToolResultBlockParam[]) =>
  uses.map((u) => results.find((r) => r.tool_use_id === u.id) || errResult(u.id, "Not run"));

function friendly(e: unknown) {
  if (e instanceof ToolError) return e.message;
  if (e instanceof Anthropic.RateLimitError) return "Bunty is busy right now — please try again in a moment.";
  if (e instanceof Anthropic.AuthenticationError) return "Bunty's Claude API key was not accepted.";
  if (e instanceof Anthropic.APIConnectionError) return "Could not reach Claude — check the internet connection.";
  if (e instanceof Anthropic.APIError) return `Claude error ${e.status ?? ""}: ${e.message}`.trim();
  return (e as Error)?.message || "Something went wrong";
}
