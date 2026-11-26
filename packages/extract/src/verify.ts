/**
 * Checks a model's reading of an invoice against the page: every quote must occur in the page's
 * text layer, and every value must appear in its quote. A value that fails either check is
 * "unverified", and the checks in @countercheck/core send the invoice to a person.
 */
import { type Invoice, normalizeId } from "@countercheck/core";
import type { Extraction } from "./schema.js";

export interface PageWord {
  text: string;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
}

export interface PageLine extends Omit<PageWord, "text"> {
  text: string;
  /** [start, end) into Page.words. */
  words: [number, number];
}

/** A page's text layer, as written by the pipeline (data/cases/<id>.page.json). */
export interface Page {
  width: number;
  height: number;
  text: string;
  lines: PageLine[];
  words: PageWord[];
}

export type CheckStatus =
  | "verified"
  | "missing"
  | "no_quote"
  | "quote_not_found"
  | "value_not_in_quote";

export interface FieldCheck {
  /** The invoice field it covers, as @countercheck/core names it ("total", "lines[0]"). */
  field: string;
  status: CheckStatus;
  quote: string | null;
  /** Indexes into Page.words that the quote covers, for highlighting. */
  words: number[];
  /** For a line: which of its values weren't in the quote. */
  failed?: string[];
}

export interface Verified {
  invoice: Invoice;
  checks: FieldCheck[];
  /** Field paths for checkInvoice's `unverified`. */
  unverified: string[];
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** The page's words in reading order, as one searchable string with word offsets. */
export class PageIndex {
  readonly text: string;
  private readonly starts: number[] = [];
  private readonly order: number[] = [];

  constructor(readonly page: Page) {
    let text = "";
    for (const line of page.lines) {
      for (let i = line.words[0]; i < line.words[1]; i++) {
        if (text) text += " ";
        this.starts.push(text.length);
        this.order.push(i);
        text += page.words[i]!.text.toLowerCase();
      }
    }
    this.text = text;
  }

  /** Word indexes covered by the first occurrence of the quote, or null if it isn't on the page. */
  find(quote: string): number[] | null {
    const q = squash(quote);
    if (q.length === 0) return null;
    const at = this.text.indexOf(q);
    if (at < 0) return null;
    const end = at + q.length;
    const covered: number[] = [];
    for (let k = 0; k < this.starts.length; k++) {
      const start = this.starts[k]!;
      const word = this.page.words[this.order[k]!]!;
      if (start < end && start + word.text.length > at) covered.push(this.order[k]!);
    }
    return covered;
  }
}

const withCommas = (fixed: string) => {
  const [whole, frac] = fixed.split(".");
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac === undefined ? grouped : `${grouped}.${frac}`;
};

/** The ways a number can be printed exactly: 1850, 1,850, 1850.00, 1,850.00; 0.0778. */
export function numberForms(n: number): string[] {
  const forms = new Set<string>();
  for (let d = 0; d <= 4; d++) {
    const fixed = Math.abs(n).toFixed(d);
    if (Math.abs(Number(fixed) - Math.abs(n)) > 1e-9) continue;
    forms.add(fixed);
    forms.add(withCommas(fixed));
  }
  return [...forms];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function quoteHasNumber(quote: string, n: number): boolean {
  return numberForms(n).some((form) =>
    new RegExp(`(?<![\\d.,])${escapeRe(form)}(?![\\d]|[.,]\\d)`).test(quote),
  );
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  mac: 3,
  apr: 4,
  may: 5,
  mei: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  ogos: 8,
  sep: 9,
  oct: 10,
  okt: 10,
  nov: 11,
  dec: 12,
  dis: 12,
};

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Dates written in a quote, read day-first as Malaysian and Singaporean invoices write them. */
export function datesIn(quote: string): string[] {
  const out: string[] = [];
  for (const m of quote.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g))
    out.push(iso(+m[1]!, +m[2]!, +m[3]!));
  for (const m of quote.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g))
    out.push(iso(+m[3]!, +m[2]!, +m[1]!));
  for (const m of quote.matchAll(/\b(\d{1,2})\s+([A-Za-z]{3,5})\.?\s+(\d{4})\b/g)) {
    const month =
      MONTHS[m[2]!.toLowerCase().slice(0, m[2]!.length >= 4 ? 4 : 3)] ??
      MONTHS[m[2]!.toLowerCase().slice(0, 3)];
    if (month) out.push(iso(+m[3]!, month, +m[1]!));
  }
  return out;
}

const textIn = (quote: string, value: string) => squash(quote).includes(squash(value));
const idIn = (quote: string, value: string) =>
  normalizeId(value).length > 0 && normalizeId(quote).includes(normalizeId(value));

type Kind = "text" | "id" | "number" | "rate" | "date";

function valueInQuote(kind: Kind, value: unknown, quote: string): boolean {
  switch (kind) {
    case "text":
      return textIn(quote, String(value));
    case "id":
      return idIn(quote, String(value));
    case "number":
      return quoteHasNumber(quote, Number(value));
    case "rate": {
      const pct = Math.round(Number(value) * 10_000) / 100;
      return numberForms(pct).some((f) => new RegExp(`(?<![\\d.])${escapeRe(f)}\\s*%`).test(quote));
    }
    case "date":
      return datesIn(quote).includes(String(value));
  }
}

const HEADER: [keyof Extraction, string, Kind][] = [
  ["vendorName", "vendorName", "text"],
  ["vendorRegistrationNo", "vendorRegistrationNo", "id"],
  ["invoiceNumber", "invoiceNumber", "id"],
  ["invoiceDate", "invoiceDate", "date"],
  ["poNumber", "poNumber", "id"],
  ["currency", "currency", "text"],
  ["subtotal", "subtotal", "number"],
  ["taxRate", "taxRate", "rate"],
  ["tax", "tax", "number"],
  ["total", "total", "number"],
  ["bankName", "bank.bankName", "text"],
  ["accountName", "bank.accountName", "text"],
  ["accountNumber", "bank.accountNumber", "id"],
];

const descriptionWords = (s: string) =>
  (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 1);

export function verifyExtraction(x: Extraction, page: Page | PageIndex): Verified {
  const index = page instanceof PageIndex ? page : new PageIndex(page);
  const checks: FieldCheck[] = [];
  const unverified: string[] = [];

  const check = (field: string, kind: Kind, value: unknown, quote: string | null) => {
    if (value === null || value === undefined || value === "") {
      checks.push({ field, status: "missing", quote, words: [] });
      return;
    }
    if (!quote?.trim()) {
      checks.push({ field, status: "no_quote", quote, words: [] });
      unverified.push(field);
      return;
    }
    const words = index.find(quote);
    if (!words) {
      checks.push({ field, status: "quote_not_found", quote, words: [] });
      unverified.push(field);
      return;
    }
    const ok = valueInQuote(kind, value, quote);
    checks.push({ field, status: ok ? "verified" : "value_not_in_quote", quote, words });
    if (!ok) unverified.push(field);
  };

  for (const [key, field, kind] of HEADER) {
    const f = x[key] as { value: unknown; quote: string | null };
    check(field, kind, f.value, f.quote);
  }

  x.lines.forEach((line, i) => {
    const field = `lines[${i}]`;
    const all = ["quantity", "unit", "unitPrice", "amount"].map((k) => `${field}.${k}`);
    const words = line.quote ? index.find(line.quote) : null;
    if (!line.quote || !words) {
      checks.push({
        field,
        status: line.quote ? "quote_not_found" : "no_quote",
        quote: line.quote,
        words: [],
      });
      unverified.push(...all);
      return;
    }
    const failed: string[] = [];
    if (!quoteHasNumber(line.quote, line.quantity)) failed.push("quantity");
    if (!textIn(line.quote, line.unit)) failed.push("unit");
    if (!quoteHasNumber(line.quote, line.unitPrice)) failed.push("unitPrice");
    if (!quoteHasNumber(line.quote, line.amount)) failed.push("amount");
    const desc = descriptionWords(line.description);
    const seen = desc.filter((w) => squash(line.quote!).includes(w)).length;
    if (desc.length > 0 && seen / desc.length < 0.6) failed.push("description");
    checks.push({
      field,
      status: failed.length ? "value_not_in_quote" : "verified",
      quote: line.quote,
      words,
      ...(failed.length ? { failed } : {}),
    });
    unverified.push(...failed.map((k) => `${field}.${k}`));
  });

  const invoice: Invoice = {
    vendorName: x.vendorName.value,
    vendorRegistrationNo: x.vendorRegistrationNo.value,
    invoiceNumber: x.invoiceNumber.value,
    invoiceDate: x.invoiceDate.value,
    poNumber: x.poNumber.value,
    currency: x.currency.value,
    lines: x.lines.map(({ quote: _quote, ...line }) => line),
    subtotal: x.subtotal.value,
    taxRate: x.taxRate.value,
    tax: x.tax.value,
    total: x.total.value,
    bank: x.accountNumber.value
      ? {
          bankName: x.bankName.value ?? "",
          accountName: x.accountName.value ?? "",
          accountNumber: x.accountNumber.value,
        }
      : null,
  };
  return { invoice, checks, unverified };
}
