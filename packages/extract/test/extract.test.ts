import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkInvoice,
  type Decision,
  type Invoice,
  reasonCodes,
  type World,
} from "@countercheck/core";
import { describe, expect, it } from "vitest";
import {
  baselineExtract,
  datesIn,
  type Extraction,
  extractInvoice,
  findModel,
  numberForms,
  type Page,
  parseExtraction,
  quoteHasNumber,
  verifyExtraction,
} from "../src/index.js";

interface Truth {
  id: string;
  situation: string;
  invoice: Invoice;
  decision: Decision;
  reasons: string[];
}
interface CaseInfo {
  id: string;
  split: string;
  layout: string;
}

const DATA = join(import.meta.dirname, "..", "..", "..", "data");
const read = <T>(...p: string[]) => JSON.parse(readFileSync(join(DATA, ...p), "utf8")) as T;
const world = read<World>("world.json");
const cases = read<CaseInfo[]>("cases.json");
const truths = readdirSync(join(DATA, "truth")).map((f) => read<Truth>("truth", f));
const page = (id: string) => read<Page>("cases", `${id}.page.json`);

/** A perfect reading of a sample invoice, quoting the page lines that show each value. */
function oracle(t: Truth): Extraction {
  const p = page(t.id);
  const lines = p.text.split("\n");
  const inv = t.invoice;
  const lineWith = (...needles: string[]) =>
    lines.find((l) => needles.every((n) => l.toLowerCase().includes(n.toLowerCase()))) ?? null;
  const numberLine = (n: number, labels: string[]) =>
    lines.find((l) => quoteHasNumber(l, n) && labels.some((lb) => l.includes(lb))) ?? null;
  const q = <T>(value: T, quote: string | null) => ({ value, quote });
  const ratePct = `${Math.round((inv.taxRate ?? 0) * 100)}%`;
  return {
    vendorName: q(inv.vendorName, lineWith(inv.vendorName)),
    vendorRegistrationNo: q(inv.vendorRegistrationNo, lineWith(inv.vendorRegistrationNo ?? "")),
    invoiceNumber: q(inv.invoiceNumber, lineWith(inv.invoiceNumber)),
    invoiceDate: q(
      inv.invoiceDate,
      lines.find((l) => datesIn(l).includes(inv.invoiceDate)) ?? null,
    ),
    poNumber: q(inv.poNumber, inv.poNumber ? lineWith(inv.poNumber) : null),
    currency: q(
      inv.currency,
      lines.find((l) =>
        new RegExp(`(^|[\\s(])${inv.currency.replace("$", "\\$")}([\\s)]|$)`).test(l),
      ) ?? null,
    ),
    lines: inv.lines.map((line) => {
      const at = lines.findIndex(
        (l) => l.includes(line.description) && quoteHasNumber(l, line.amount),
      );
      const row = lines[at]!;
      const quote = quoteHasNumber(row, line.unitPrice) ? row : `${row}\n${lines[at + 1]}`;
      return { ...line, quote };
    }),
    subtotal: q(inv.subtotal, numberLine(inv.subtotal, ["Subtotal", "Jumlah Kecil"])),
    taxRate: q(inv.taxRate, lineWith(ratePct)),
    tax: q(inv.tax, numberLine(inv.tax, ["SST", "GST"])),
    total: q(inv.total, numberLine(inv.total, ["Total", "TOTAL", "Jumlah Besar"])),
    bankName: q(inv.bank?.bankName ?? null, lineWith(inv.bank?.bankName ?? "")),
    accountName: q(inv.bank?.accountName ?? null, lineWith(inv.bank?.accountName ?? "")),
    accountNumber: q(inv.bank?.accountNumber ?? null, lineWith(inv.bank?.accountNumber ?? "")),
  };
}

describe("verifyExtraction", () => {
  it.each(truths.map((t) => [t.id, t.situation, t] as const))(
    "%s (%s): a perfect reading verifies and gets the known decision",
    (_id, _s, t) => {
      const v = verifyExtraction(oracle(t), page(t.id));
      expect(v.unverified).toEqual([]);
      const r = checkInvoice({ invoice: v.invoice, world, unverified: v.unverified });
      expect({ decision: r.decision, reasons: reasonCodes(r) }).toEqual({
        decision: t.decision,
        reasons: t.reasons,
      });
      // Every quote points at words on the page, for the highlighter.
      for (const c of v.checks.filter((c) => c.status === "verified")) {
        expect(c.words.length).toBeGreaterThan(0);
      }
    },
  );

  const clean = truths.find((t) => t.decision === "approve" && t.invoice.poNumber)!;

  it("flags a value that isn't in its quote", () => {
    const x = oracle(clean);
    x.total.value += 100;
    const v = verifyExtraction(x, page(clean.id));
    expect(v.unverified).toEqual(["total"]);
    expect(v.checks.find((c) => c.field === "total")!.status).toBe("value_not_in_quote");
    const r = checkInvoice({ invoice: v.invoice, world, unverified: v.unverified });
    expect(r.decision).toBe("hold");
    expect(reasonCodes(r)).toContain("UNVERIFIED_FIELD");
  });

  it("flags a quote that isn't on the page, such as an invented PO number", () => {
    const x = oracle(clean);
    x.poNumber = { value: "PO-260001", quote: "PO No. PO-260001" };
    const v = verifyExtraction(x, page(clean.id));
    expect(v.checks.find((c) => c.field === "poNumber")!.status).toBe("quote_not_found");
    expect(v.unverified).toContain("poNumber");
  });

  it("flags a value with no quote, and a line whose numbers aren't in its row", () => {
    const x = oracle(clean);
    x.invoiceNumber.quote = null;
    x.lines[0]!.quantity += 1;
    const v = verifyExtraction(x, page(clean.id));
    expect(v.unverified).toEqual(["invoiceNumber", "lines[0].quantity"]);
  });

  it("treats a field absent from the page as missing, not unverified", () => {
    const noPo = truths.find((t) => t.situation === "no_po")!;
    const v = verifyExtraction(oracle(noPo), page(noPo.id));
    expect(v.checks.find((c) => c.field === "poNumber")!.status).toBe("missing");
    expect(v.unverified).toEqual([]);
  });

  it("ignores case and line breaks in quotes", () => {
    const x = oracle(clean);
    x.invoiceNumber.quote = x.invoiceNumber.quote!.toUpperCase().replace(" ", "\n  ");
    expect(verifyExtraction(x, page(clean.id)).unverified).toEqual([]);
  });
});

describe("number and date forms", () => {
  it("prints numbers the ways invoices do", () => {
    expect(numberForms(1850)).toEqual(
      expect.arrayContaining(["1850", "1,850", "1850.00", "1,850.00"]),
    );
    expect(numberForms(0.0778)).toContain("0.0778");
    expect(quoteHasNumber("Total (RM) 1,850.00", 1850)).toBe(true);
    expect(quoteHasNumber("Total (RM) 11,850.00", 1850)).toBe(false);
    expect(quoteHasNumber("Total (RM) 1,850.50", 1850)).toBe(false);
  });

  it("reads dates day first, in English and Malay", () => {
    expect(datesIn("Date 05/10/2026")).toEqual(["2026-10-05"]);
    expect(datesIn("Issued: 5 Oct 2026")).toEqual(["2026-10-05"]);
    expect(datesIn("Tarikh 27 Okt 2026")).toEqual(["2026-10-27"]);
    expect(datesIn("Tarikh 3 Ogos 2026")).toEqual(["2026-08-03"]);
    expect(datesIn("Date: 2026-11-02")).toEqual(["2026-11-02"]);
  });
});

describe("parseExtraction", () => {
  it("accepts numbers written as text and a rate written as a percentage", () => {
    const x = oracle(truths[0]!);
    const reply = JSON.stringify({
      ...x,
      total: { value: "1,234.50", quote: "x" },
      taxRate: { value: 10, quote: "SST 10%" },
    });
    const parsed = parseExtraction(`Here it is:\n${reply}\nDone.`);
    expect(parsed.ok && parsed.value.total.value).toBe(1234.5);
    expect(parsed.ok && parsed.value.taxRate.value).toBe(0.1);
  });

  it("explains what's wrong with a reply", () => {
    expect(parseExtraction("no json").ok).toBe(false);
    const bad = parseExtraction('{"vendorName": {"value": "x"}}');
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toContain("invoiceNumber");
  });
});

describe("extractInvoice", () => {
  const gemma = findModel("gemma-4")!;
  const good = JSON.stringify(oracle(truths[0]!));

  it("retries once with the error when the first reply doesn't parse", async () => {
    const seen: string[][] = [];
    const replies = ["{oops", good];
    const r = await extractInvoice("page text", gemma, async (_m, input) => {
      seen.push(input.messages.map((m) => m.role));
      return {
        text: replies.shift()!,
        usage: { prompt_tokens: 1000, completion_tokens: 400, neurons: 20 },
      };
    });
    expect(r.extraction).not.toBeNull();
    expect(r.attempts).toBe(2);
    expect(r.neurons).toBe(40);
    expect(seen[1]).toEqual(["system", "user", "assistant", "user"]);
  });

  it("gives up after two bad replies and estimates neurons from tokens", async () => {
    const r = await extractInvoice("page text", gemma, async () => ({
      text: "not json",
      usage: { prompt_tokens: 1_000_000, completion_tokens: 0 },
    }));
    expect(r.extraction).toBeNull();
    expect(r.error).toContain("no JSON");
    expect(r.neurons).toBe(2 * 9091);
  });
});

describe("baselineExtract (no model)", () => {
  it("reads the English template it was written for, and nothing else", () => {
    const byLayout = new Map<string, number>();
    for (const c of cases) {
      const t = truths.find((x) => x.id === c.id)!;
      const b = baselineExtract(page(c.id).text);
      if (!b.extraction) continue;
      const v = verifyExtraction(b.extraction, page(c.id));
      expect(v.unverified).toEqual([]);
      expect(v.invoice.total).toBe(t.invoice.total);
      byLayout.set(c.layout, (byLayout.get(c.layout) ?? 0) + 1);
    }
    expect(byLayout.get("ledger")).toBe(cases.filter((c) => c.layout === "ledger").length);
    expect(byLayout.get("malay") ?? 0).toBe(0);
  });
});
