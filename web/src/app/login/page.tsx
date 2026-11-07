"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Loader2 } from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { Button, Field, Input } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const { ready, session, blocked, signOut } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "bad" | "good"; text: string } | null>(null);

  useEffect(() => { if (ready && session && !blocked) router.replace("/"); }, [ready, session, blocked, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const { error } = await db.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setMsg({ tone: "bad", text: error.message === "Invalid login credentials" ? "Email or password is wrong." : error.message });
  }

  async function reset() {
    if (!email.trim()) { setMsg({ tone: "bad", text: "Type your email first, then press “Forgot password”." }); return; }
    const { error } = await db.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}/login` });
    setMsg(error ? { tone: "bad", text: error.message } : { tone: "good", text: "Check your email for a reset link." });
  }

  return (
    <main className="min-h-dvh grid place-items-center px-4 py-10">
      <div className="w-full max-w-sm animate-in">
        <div className="flex items-center gap-2.5 mb-8">
          <div className="size-9 rounded-xl bg-accent text-white grid place-items-center shadow-card"><Building2 size={18} /></div>
          <div>
            <div className="font-semibold text-ink leading-tight">Usama Real Estate</div>
            <div className="text-xs text-ink-3">Company system</div>
          </div>
        </div>

        {blocked ? (
          <div className="rounded-xl border border-line bg-surface p-5 text-sm text-ink-2">
            This account has no active access. Ask the admin to add or re-activate you.
            <Button className="mt-4 w-full" onClick={signOut}>Sign out</Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <h1 className="text-xl font-semibold tracking-tight text-ink">Sign in</h1>
            <Field label="Email">
              <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </Field>
            <Field label="Password">
              <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {msg && <div className={msg.tone === "bad" ? "text-sm text-bad" : "text-sm text-good"}>{msg.text}</div>}
            <Button variant="primary" className="w-full h-10" disabled={busy}>
              {busy && <Loader2 size={16} className="animate-spin" />} Sign in
            </Button>
            <button type="button" onClick={reset} className="w-full text-center text-sm text-ink-3 hover:text-ink">Forgot password</button>
          </form>
        )}
      </div>
    </main>
  );
}
