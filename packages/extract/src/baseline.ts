/**
 * A template parser with no model: regular expressions for one English layout's labels. It is
 * here to be honest about what the model adds. It reads that one layout and fails on the others,
 * and it runs offline for tests and the browser check.
 */
import type { Extraction } from "./schema.js";

type Q<T> = { value: T; quote: string | null };
const none = <T>(): Q<T | null> => ({ value: null, quote: null });

function grab(text: string, re: RegExp): { value: string; quote: string } | null {
  const m = re.exec(text);
  return m ? { value: m[1]!.trim(), quote: m[0].trim() } : null;
}

const num = (s: string) => Number(s.replace(/,/g, ""));

export interface BaselineResult {
  extraction: Extraction | null;
  /** Required fields it couldn't find. */
  missing: string[];
}

export function baselineExtract(text: string): BaselineResult {
  const vendor = grab(text, /^(.+?)\s+TAX INVOICE$/m);
  const invoiceNumber = grab(text, /Invoice No\.\s+(\S+)/);
  const date = grab(text, /^Date\s+(\d{2}\/\d{2}\/\d{4})/m);
  const currency = grab(text, /^Total \((RM|MYR|SGD|S\$)\)/m);
  const total = grab(text, /^Total \((?:RM|MYR|SGD|S\$)\)\s+([\d,]+\.\d{2})$/m);
  const subtotal = grab(text, /^Subtotal\s+([\d,]+\.\d{2})$/m);
  const taxLine = /^(?:SST|GST)\s+(\d+(?:\.\d+)?)%\s+([\d,]+\.\d{2})$/m.exec(text);
  const lines = [
    ...text.matchAll(
      /^\d+\s+(.+?)\s+([\d,]+)\s+([A-Za-z]+)\s+([\d,]+\.\d{2,4})\s+([\d,]+\.\d{2})$/gm,
    ),
  ];

  const missing = Object.entries({ vendor, invoiceNumber, date, currency, total, subtotal })
    .filter(([, v]) => v === null)
    .map(([k]) => k);
  if (!taxLine) missing.push("tax");
  if (lines.length === 0) missing.push("lines");
  if (missing.length > 0) return { extraction: null, missing };

  const [dd, mm, yyyy] = date!.value.split("/");
  const field = (g: { value: string; quote: string } | null): Q<string | null> =>
    g ? { value: g.value, quote: g.quote } : none<string>();
  const reg = grab(text, /Reg\. No: (\S+(?: \([^)]+\))?)/);
  const bank = grab(text, /^Bank:\s+(.+)$/m);
  const accountName = grab(text, /^Account name:\s+(.+)$/m);
  const accountNumber = grab(text, /^Account no\.:\s+(.+)$/m);
  const po = grab(text, /PO No\.\s+(\S+)/);

  return {
    missing: [],
    extraction: {
      vendorName: { value: vendor!.value, quote: vendor!.quote },
      vendorRegistrationNo: field(reg),
      invoiceNumber: { value: invoiceNumber!.value, quote: invoiceNumber!.quote },
      invoiceDate: { value: `${yyyy}-${mm}-${dd}`, quote: date!.quote },
      poNumber: field(po),
      currency: { value: currency!.value, quote: currency!.quote },
      lines: lines.map((m) => ({
        description: m[1]!,
        sku: null,
        quantity: num(m[2]!),
        unit: m[3]!,
        unitPrice: num(m[4]!),
        amount: num(m[5]!),
        quote: m[0],
      })),
      subtotal: { value: num(subtotal!.value), quote: subtotal!.quote },
      taxRate: { value: Number(taxLine![1]) / 100, quote: taxLine![0] },
      tax: { value: num(taxLine![2]!), quote: taxLine![0] },
      total: { value: num(total!.value), quote: total!.quote },
      bankName: field(bank),
      accountName: field(accountName),
      accountNumber: field(accountNumber),
    },
  };
}
