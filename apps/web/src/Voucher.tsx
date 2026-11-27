import type { CheckResult, Decision, Invoice, ReasonCode } from "@countercheck/core";
import { fieldLabel } from "@countercheck/core";
import type { FieldCheck } from "@countercheck/extract";
import type { ReactNode } from "react";
import type { Reading } from "./api-types";
import type { Truth } from "./data";
import { money, price, quantity, seconds, shortDate } from "./format";

export const REASON: Record<ReasonCode, string> = {
  UNVERIFIED_FIELD: "a value it couldn't confirm on the page",
  UNKNOWN_VENDOR: "a vendor that isn't on the list",
  BANK_DETAILS_CHANGED: "changed bank details",
  NO_PO: "no purchase order number",
  PO_NOT_FOUND: "a purchase order that doesn't exist",
  PO_OTHER_VENDOR: "another vendor's purchase order",
  CURRENCY_MISMATCH: "the wrong currency",
  NOT_ORDERED: "an item nobody ordered",
  UOM_MISMATCH: "a different unit of measure",
  PRICE_VARIANCE: "a price above the purchase order",
  SHORT_DELIVERY: "more billed than delivered",
  LINE_MATH: "a line that doesn't add up",
  TAX_MISMATCH: "the wrong tax",
  TOTAL_MISMATCH: "totals that don't add up",
  DUPLICATE_INVOICE: "an invoice that was already posted",
  POSSIBLE_DUPLICATE: "the same amount billed again within weeks",
};

const VERDICT: Record<Decision, { title: string; ink: string; wash: string }> = {
  approve: { title: "Ready to approve", ink: "text-approve", wash: "bg-approve-wash" },
  hold: { title: "Hold it for a person", ink: "text-hold", wash: "bg-hold-wash" },
  reject: { title: "Reject it", ink: "text-hold", wash: "bg-hold-wash" },
};

const ACTION: Record<Decision, string> = {
  approve: "Approve for payment",
  hold: "Put on hold",
  reject: "Reject",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-rule-faint px-5 py-4 sm:px-6">
      <h3 className="mb-2 text-[0.95rem] font-[700]">{title}</h3>
      {children}
    </section>
  );
}

function statusOf(checks: FieldCheck[], field: string): FieldCheck["status"] | undefined {
  return checks.find((c) => c.field === field)?.status;
}

function Tick({ status }: { status: FieldCheck["status"] | undefined }) {
  const [mark, label, tone] =
    status === "verified"
      ? ["✓", "found on the page", "text-approve"]
      : status === "missing"
        ? ["–", "not on the invoice", "text-ink-soft"]
        : ["!", "couldn't confirm on the page", "font-[800] text-hold"];
  return (
    <span className={tone}>
      <span aria-hidden="true">{mark}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Pointing at a value highlights it on the invoice too; a pointer extra, nothing depends on it. */
function hover(onFocus: (field: string | null) => void, field: string | null) {
  return { onPointerEnter: () => onFocus(field), onPointerLeave: () => onFocus(null) };
}

export function Voucher({
  truth,
  reading,
  checks,
  invoice,
  result,
  decided,
  onDecide,
  onFocus,
  onNext,
  live,
  ledger,
}: {
  truth: Truth;
  reading: Reading;
  checks: FieldCheck[];
  invoice: Invoice;
  result: CheckResult;
  decided: Decision | null;
  onDecide: (d: Decision) => void;
  onFocus: (field: string | null) => void;
  onNext: () => void;
  live: ReactNode;
  /** The posting's progress, once approved. */
  ledger: ReactNode;
}) {
  const verdict = VERDICT[result.decision];
  const cur = invoice.currency;
  const header: [string, string, ReactNode][] = [
    ["vendorName", "Vendor", invoice.vendorName],
    ["invoiceNumber", "Invoice", invoice.invoiceNumber],
    ["invoiceDate", "Dated", shortDate(invoice.invoiceDate)],
    ["poNumber", "Purchase order", invoice.poNumber ?? "None quoted"],
    ["total", "Total", money(invoice.total, cur)],
    ["bank.accountNumber", "Pay to account", invoice.bank?.accountNumber ?? "Not printed"],
  ];
  const second = result.decision === "approve" ? "hold" : "approve";
  const known = truth.decision;

  return (
    <div className="paper text-[0.95rem]">
      <header className={`px-5 py-4 sm:px-6 ${verdict.wash}`} aria-live="polite">
        <p className={`text-[1.35rem] leading-tight font-[800] ${verdict.ink}`}>{verdict.title}</p>
        <p className="mt-1 text-ink">
          {result.findings[0]?.message ??
            "It matches the purchase order, what was delivered, and nothing like it was paid before."}
        </p>
        {result.findings.length > 1 && (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-ink">
            {result.findings.slice(1).map((f) => (
              <li key={`${f.code}:${f.field}`} {...hover(onFocus, f.field ?? null)}>
                {f.message}
              </li>
            ))}
          </ul>
        )}
      </header>

      <Section title="Read from the invoice">
        <dl className="ruled">
          {header.map(([field, label, value]) => (
            <div
              key={field}
              className="grid grid-cols-[8.5rem_1fr_1.25rem] items-baseline gap-2 py-1.5"
              {...hover(onFocus, field)}
            >
              <dt className="text-ink-soft">{label}</dt>
              <dd
                className={`tnum min-w-0 truncate font-[600] ${result.findings.some((f) => f.field === field) ? "text-hold" : ""}`}
              >
                {value}
              </dd>
              <dd className="text-right">
                <Tick status={statusOf(checks, field)} />
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-[0.85rem] text-ink-soft">
          ✓ means Countercheck found this value written on the invoice itself, not guessed.
        </p>
      </Section>

      <Section
        title={result.po ? `Against ${result.po.number} and its deliveries` : "Against the order"}
      >
        {result.po ? (
          <div className="-mx-1 overflow-x-auto">
            <table className="tnum w-full min-w-[19rem] text-left text-[0.88rem]">
              <thead className="text-ink-soft">
                <tr>
                  <th className="px-1 py-1 font-[600]">Item</th>
                  <th className="px-1 py-1 text-right font-[600]">Delivered</th>
                  <th className="px-1 py-1 text-right font-[600]">Billed</th>
                  <th className="px-1 py-1 text-right font-[600]">Price</th>
                </tr>
              </thead>
              <tbody className="ruled">
                {invoice.lines.map((line, i) => {
                  const m = result.lines[i];
                  const flag = (part: string) =>
                    result.findings.some((f) => f.line === i && f.field?.endsWith(part));
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: a reading's lines never reorder; the position is the line.
                    <tr key={`line-${i}`} {...hover(onFocus, `lines[${i}]`)}>
                      <td
                        className={`px-1 py-1.5 ${flag("description") ? "font-[700] text-hold" : ""}`}
                      >
                        {line.description}
                      </td>
                      <td className="whitespace-nowrap px-1 py-1.5 text-right">
                        {m?.received != null ? (
                          <>
                            {quantity(m.received - (m.alreadyInvoiced ?? 0))} {m.poUnit}
                            {m.alreadyInvoiced ? (
                              <span className="block text-[0.78rem] text-ink-soft">
                                of {quantity(m.received)}, {quantity(m.alreadyInvoiced)} billed
                                before
                              </span>
                            ) : null}
                          </>
                        ) : (
                          "–"
                        )}
                      </td>
                      <td
                        className={`whitespace-nowrap px-1 py-1.5 text-right ${flag("quantity") || flag("unit") ? "font-[700] text-hold" : ""}`}
                      >
                        {quantity(line.quantity)} {line.unit}
                      </td>
                      <td
                        className={`whitespace-nowrap px-1 py-1.5 text-right ${flag("unitPrice") ? "font-[700] text-hold" : ""}`}
                      >
                        {price(line.unitPrice)}
                        {m?.poUnitPrice != null &&
                          Math.abs(m.poUnitPrice - line.unitPrice) > 0.001 && (
                            <span className="block text-[0.78rem] font-[500] text-ink-soft">
                              PO {price(m.poUnitPrice)}
                            </span>
                          )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-ink-soft">
            {invoice.poNumber
              ? "That purchase order couldn't be used"
              : "No purchase order to match"}
            , so the lines weren't checked against an order.
          </p>
        )}
      </Section>

      <Section title={decided ? "Your decision" : "Your call"}>
        {decided ? (
          <div className="reveal space-y-3">
            <p>
              You chose <b>{ACTION[decided].toLowerCase()}</b>.{" "}
              {decided === known ? "That matches the known answer" : "The known answer differs"}:{" "}
              <b>{ACTION[known].toLowerCase()}</b>
              {truth.reasons.length > 0 && (
                <>, for {truth.reasons.map((r) => REASON[r as ReasonCode] ?? r).join(" and ")}</>
              )}
              .
            </p>
            <p className="text-ink-soft">
              Countercheck recommended {ACTION[result.decision].toLowerCase()}
              {result.decision === known
                ? ", which is right."
                : ", which is wrong for this invoice."}
            </p>
            {ledger}
            <button
              type="button"
              onClick={onNext}
              className="rounded-[3px] bg-ink px-4 py-2.5 font-[700] text-paper hover:bg-ink/85"
            >
              Next invoice
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onDecide(result.decision)}
              className={`rounded-[3px] px-4 py-2.5 font-[700] text-paper ${result.decision === "approve" ? "bg-approve hover:bg-approve/90" : "bg-hold hover:bg-hold/90"}`}
            >
              {ACTION[result.decision]}
            </button>
            <button
              type="button"
              onClick={() => onDecide(second)}
              className="rounded-[3px] border border-ink/30 px-4 py-2.5 font-[650] hover:border-ink"
            >
              {second === "approve" ? "Approve anyway" : "Hold instead"}
            </button>
          </div>
        )}
      </Section>

      <details className="border-t border-rule-faint px-5 py-3 sm:px-6">
        <summary className="cursor-pointer font-[650] text-ink-soft hover:text-ink">
          How this reading was made
        </summary>
        <div className="mt-3 space-y-3 text-[0.9rem]">
          <dl className="tnum ruled">
            {[
              ["Read by", reading.model.label],
              [
                "When",
                `${new Date(reading.readAt).toLocaleString("en-GB", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "UTC",
                })} UTC`,
              ],
              ["Model calls", String(reading.attempts)],
              [
                "Tokens",
                `${reading.inputTokens.toLocaleString()} in, ${reading.outputTokens.toLocaleString()} out`,
              ],
              ["Cost", `${reading.neurons.toFixed(1)} neurons of the free daily allowance`],
              ["Time", seconds(reading.latencyMs)],
              [
                "Quotes found",
                `${checks.filter((c) => c.status === "verified").length} of ${checks.filter((c) => c.status !== "missing").length}`,
              ],
            ].map(([k, v]) => (
              <div key={k} className="grid grid-cols-[7.5rem_1fr] gap-2 py-1">
                <dt className="text-ink-soft">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {checks.some((c) => c.status !== "verified" && c.status !== "missing") && (
            <p>
              Couldn't confirm:{" "}
              {checks
                .filter((c) => c.status !== "verified" && c.status !== "missing")
                .map((c) => fieldLabel(c.field))
                .join(", ")}
              .
            </p>
          )}
          {reading.replies[0] && (
            <details>
              <summary className="cursor-pointer text-ink-soft hover:text-ink">
                The model's reply
              </summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded-[3px] bg-desk/60 p-3 text-[0.75rem] leading-snug whitespace-pre-wrap">
                {reading.replies[reading.replies.length - 1]}
              </pre>
            </details>
          )}
          {live}
        </div>
      </details>
    </div>
  );
}
