import type { JsonSchema, PropSchema } from "./types";

/** Checks a tool input against its schema. Returns the cleaned input or a readable error. */
export function validateInput(schema: JsonSchema, raw: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Input must be an object" };
  const input = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(input)) {
    if (!(k in schema.properties)) return { ok: false, error: `Unknown field "${k}"` };
  }
  for (const k of schema.required || []) {
    if (input[k] === undefined || input[k] === null || input[k] === "") return { ok: false, error: `Missing "${k}"` };
  }
  for (const [k, p] of Object.entries(schema.properties)) {
    const v = input[k];
    if (v === undefined || v === null) continue;
    const err = check(p, v);
    if (err) return { ok: false, error: `"${k}": ${err}` };
    out[k] = typeof v === "string" ? v.trim() : v;
  }
  return { ok: true, value: out };
}

function check(p: PropSchema, v: unknown): string | null {
  switch (p.type) {
    case "string": {
      if (typeof v !== "string") return "must be text";
      if (p.maxLength && v.length > p.maxLength) return `longer than ${p.maxLength} characters`;
      if (p.enum && !p.enum.includes(v)) return `must be one of ${p.enum.join(", ")}`;
      if (p.format === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return "must be a date YYYY-MM-DD";
      if (p.format === "time" && !/^\d{2}:\d{2}$/.test(v)) return "must be a time HH:MM";
      if (p.format === "date-time" && Number.isNaN(Date.parse(v))) return "must be a date and time";
      return null;
    }
    case "integer":
    case "number": {
      if (typeof v !== "number" || !Number.isFinite(v)) return "must be a number";
      if (p.type === "integer" && !Number.isInteger(v)) return "must be a whole number";
      if (p.minimum !== undefined && v < p.minimum) return `must be at least ${p.minimum}`;
      if (p.maximum !== undefined && v > p.maximum) return `must be at most ${p.maximum}`;
      return null;
    }
    case "boolean":
      return typeof v === "boolean" ? null : "must be true or false";
    case "array":
      if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) return "must be a list of text";
      if (p.maxItems && v.length > p.maxItems) return `at most ${p.maxItems} items`;
      return null;
  }
}
