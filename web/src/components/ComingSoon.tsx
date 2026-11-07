import { Card } from "@/components/ui";

export function ComingSoon({ title, step, points }: { title: string; step: string; points: string[] }) {
  return (
    <div className="animate-in">
      <h1 className="text-[22px] font-semibold tracking-tight text-ink mb-6">{title}</h1>
      <Card className="p-6 max-w-2xl">
        <div className="text-xs font-semibold uppercase tracking-wider text-accent-text">{step}</div>
        <div className="mt-1 text-ink font-medium">Being built next, as agreed in the company plan.</div>
        <ul className="mt-4 space-y-2 text-sm text-ink-2">
          {points.map((p) => <li key={p} className="flex gap-2"><span className="mt-2 size-1.5 rounded-full bg-accent shrink-0" />{p}</li>)}
        </ul>
      </Card>
    </div>
  );
}
