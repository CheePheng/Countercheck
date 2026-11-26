import type { ReasonCode } from "@countercheck/core";
import { useState } from "react";
import { type EvalResult, type EvalSummary, evals } from "./data";
import { shortDate } from "./format";
import { REASON } from "./Voucher";

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

function Row({ label, s, strong }: { label: string; s: EvalSummary; strong?: boolean }) {
  return (
    <tr className={strong ? "font-[650]" : ""}>
      <th scope="row" className="py-2 pr-3 text-left font-[600]">
        {label}
      </th>
      <td className="px-3 py-2 text-right">
        {s.read} of {s.invoices}
      </td>
      <td className="px-3 py-2 text-right">{pct(s.fieldAccuracy)}</td>
      <td className="px-3 py-2 text-right">
        {s.decisionsRight} of {s.invoices}
      </td>
      <td className={`px-3 py-2 text-right ${s.falseApprovals ? "font-[800] text-hold" : ""}`}>
        {s.falseApprovals}
      </td>
      <td className="px-3 py-2 text-right">{s.falseHolds}</td>
      <td className="px-3 py-2 text-right">
        {s.neuronsPerInvoice ? s.neuronsPerInvoice.toFixed(0) : "0"}
      </td>
      <td className="px-3 py-2 text-right">
        {s.secondsP50 !== null ? `${s.secondsP50.toFixed(1)} s` : "–"}
      </td>
    </tr>
  );
}

function Details({ e }: { e: EvalResult }) {
  const [open, setOpen] = useState(false);
  const misses = e.cases.filter((c) => !c.decisionRight || c.wrong.length > 0);
  if (misses.length === 0) {
    return <p className="mt-1">Every invoice was read right and got the right decision.</p>;
  }
  return (
    <div className="mt-3">
      <button
        type="button"
        className="font-[650] text-ink-soft underline hover:text-ink"
        onClick={() => setOpen(!open)}
      >
        {open ? "Hide" : "Show"} the {misses.length} invoices {e.model.label} didn't get fully right
      </button>
      {open && (
        <ul className="ruled mt-2 text-[0.9rem]">
          {misses.map((c) => (
            <li key={c.id} className="grid gap-1 py-2 sm:grid-cols-[5rem_1fr]">
              <a className="font-[650] underline" href={`#/${c.id}`}>
                {c.id}
              </a>
              <span>
                {c.read ? "" : "Couldn't read it. "}
                Decided <b>{c.decision}</b>, known answer <b>{c.knownDecision}</b>
                {c.knownReasons.length > 0 && (
                  <> ({c.knownReasons.map((r) => REASON[r as ReasonCode] ?? r).join(", ")})</>
                )}
                .{c.wrong.length > 0 && <> Read wrong: {c.wrong.join(", ")}.</>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Evals() {
  const runs = evals.filter((e) => e.summary.all.invoices > 0);
  return (
    <article className="paper mx-auto max-w-[62rem] px-5 py-6 sm:px-8 sm:py-8">
      <h1 className="text-[2rem] leading-tight font-[800]">How well it checks</h1>
      <p className="mt-3 max-w-[44rem] text-ink-soft">
        Every sample invoice has a known answer: what it says, and whether it should be approved,
        held or rejected. These are real, unedited readings of all{" "}
        {runs[0]?.summary.all.invoices ?? 28} invoices, scored against those answers. The number
        that matters most is the bad invoices it would have paid.
      </p>
      {runs.length === 0 ? (
        <p className="mt-6">No eval has been run yet.</p>
      ) : (
        <>
          <div className="mt-6 overflow-x-auto">
            <table className="tnum w-full min-w-[46rem] text-[0.95rem]">
              <thead className="text-left text-[0.85rem] text-ink-soft">
                <tr className="border-b-2 border-rule">
                  <th className="py-2 pr-3 font-[600]">Reader</th>
                  <th className="px-3 py-2 text-right font-[600]">Read</th>
                  <th className="px-3 py-2 text-right font-[600]">Fields right</th>
                  <th className="px-3 py-2 text-right font-[600]">Right decision</th>
                  <th className="px-3 py-2 text-right font-[600]">Bad invoices approved</th>
                  <th className="px-3 py-2 text-right font-[600]">Good invoices held</th>
                  <th className="px-3 py-2 text-right font-[600]">Neurons each</th>
                  <th className="px-3 py-2 text-right font-[600]">Time each</th>
                </tr>
              </thead>
              <tbody className="ruled">
                {runs.map((e) => (
                  <Row
                    key={e.model.key}
                    label={e.model.label}
                    s={e.summary.all}
                    strong={e.model.key !== "baseline"}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[0.85rem] text-ink-soft">
            {runs.map((e) => `${e.model.label}: run on ${shortDate(e.runAt)}`).join(". ")}. Time is
            the median per invoice.
          </p>
          {runs.map((e) => (
            <section key={e.model.key} className="double-rule mt-6 pt-4">
              <h2 className="text-[1.2rem] font-[750]">{e.model.label}</h2>
              <p className="mt-1 text-ink-soft">
                Held-out invoices (never used while writing the prompt):{" "}
                {e.summary.test
                  ? `${e.summary.test.decisionsRight} of ${e.summary.test.invoices} decisions right, ${e.summary.test.falseApprovals} bad invoices approved.`
                  : "not run."}{" "}
                Development invoices:{" "}
                {e.summary.dev
                  ? `${e.summary.dev.decisionsRight} of ${e.summary.dev.invoices} right, ${e.summary.dev.falseApprovals} bad invoices approved.`
                  : "not run."}
              </p>
              {e.failures && e.failures.length > 0 && (
                <p className="mt-1 text-ink-soft">
                  Failed calls, each read again in a later run:{" "}
                  {e.failures
                    .map((f) => `${f.id} (${f.message.replace(/\.$/, "").toLowerCase()})`)
                    .join(", ")}
                  .
                </p>
              )}
              <Details e={e} />
            </section>
          ))}
          <section className="double-rule mt-6 pt-4">
            <h2 className="text-[1.2rem] font-[750]">What this does and doesn't show</h2>
            <p className="mt-2 text-ink-soft">
              These 28 invoices are clean PDFs with a text layer, in four layouts and two languages.
              A perfect score here says the reading, the quote checks and the rules work together.
              It doesn't say how the model does on scanned or photographed invoices, handwriting, or
              layouts it has never seen; those aren't in the test set yet.
            </p>
          </section>
          <section className="double-rule mt-6 pt-4 text-ink-soft">
            <h2 className="text-[1.2rem] font-[750] text-ink">What the columns mean</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Read: the reply could be turned into an invoice at all.</li>
              <li>
                Fields right: header fields and line values that match the known answer exactly.
              </li>
              <li>
                Bad invoices approved: invoices that should have been held or rejected, but would
                have been proposed for payment. Good invoices held: work sent to a person for
                nothing.
              </li>
              <li>
                The template parser is plain code with no model. It reads one layout and holds
                everything else, which is why it never approves a bad invoice and still isn't
                useful.
              </li>
            </ul>
          </section>
        </>
      )}
    </article>
  );
}
