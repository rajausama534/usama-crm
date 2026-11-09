"use client";

import "./breakdown-doc.css";
import { DETAILS, MEDIA, calc, mediaUrl, money, normalize, num, phone, rows, waLink, type PayRow } from "@/lib/breakdown";

const CLS = { strong: "pbStrong", transfer: "pbTransfer", plan: "pbPlan", total: "pbTotal" };
const Row = ({ r: [l, v, k] }: { r: PayRow }) => <tr className={k ? CLS[k] : ""}><td>{l}</td><td>{money(v)}</td></tr>;

/** What the client sees: the same page on the public link, in the preview and on A4. */
export function BreakdownDoc({ data }: { data: unknown }) {
  const d = normalize(data), c = calc(d);
  const details = DETAILS.filter(([k]) => d[k]);
  return (
    <article className="pbDoc">
      <header className="pbHead"><h1>{d.title || "Property"}</h1>{d.subtitle && <p>{d.subtitle}</p>}</header>
      {details.length > 0 && <section><h2>Property Details</h2><div className="pbGrid">{details.map(([k, l]) => <div className="pbCell" key={k}><span>{l}</span><strong>{d[k]}</strong></div>)}</div></section>}
      <section><h2>Payment Breakdown</h2><table className="pbTable"><tbody>{rows(d, c).map((r) => <Row key={r[0]} r={r} />)}</tbody></table></section>
      {c.plan.length > 0 && <section><h2>Remaining Installments</h2><table className="pbTable"><tbody>{c.plan.map((x, i) => <Row key={i} r={[x.label, num(x.amount)]} />)}</tbody></table></section>}
      {d.notes && <p className="pbNotes">{d.notes}</p>}
      {phone(d.whatsapp) && <a className="pbWa" href={waLink(d)} target="_blank" rel="noopener noreferrer">Contact on WhatsApp</a>}
      <p className="pbFoot">Figures are indicative and subject to final confirmation.</p>
      {MEDIA.filter(([k]) => d[k].length).map(([k, label]) => (
        <section key={k} className={`pbMedia pbMedia-${k}`}>
          <h2>{label}{k !== "pictures" && d[k].length > 1 ? "s" : ""}</h2>
          <div className="pbMediaGrid">
            {d[k].map((x) => (
              <a key={x.path} href={mediaUrl(x.path)} target="_blank" rel="noopener noreferrer">
                {/* Client uploads of any size, served straight from storage. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mediaUrl(x.path)} alt={x.name || label} loading="lazy" />
              </a>
            ))}
          </div>
        </section>
      ))}
    </article>
  );
}
