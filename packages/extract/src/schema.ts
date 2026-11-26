/**
 * What the model returns for one invoice: every field with the stretch of the page it was read
 * from. Lenient on form (numbers as "1,850.00", a tax rate as 10), strict on substance.
 */
import { z } from "zod";

const toNumber = (v: unknown) => {
  if (typeof v !== "string") return v;
  const cleaned = v.replace(/[,\s]/g, "").replace(/^(RM|MYR|SGD|S\$)/i, "");
  return cleaned === "" ? v : Number(cleaned);
};

export const Num = z.preprocess(toNumber, z.number().finite());
/** A rate as a fraction; 10 or "10%" become 0.1. */
export const Rate = z.preprocess((v) => {
  const n = toNumber(typeof v === "string" ? v.replace("%", "") : v);
  return typeof n === "number" && n > 1 ? n / 100 : n;
}, z.number().min(0).max(1));

const quote = z.string().nullable();
const quoted = <T extends z.ZodType>(value: T) => z.object({ value, quote });

export const ExtractedLine = z.object({
  description: z.string(),
  sku: z.string().nullable(),
  quantity: Num,
  unit: z.string(),
  unitPrice: Num,
  amount: Num,
  /** The item's row as printed. */
  quote,
});

export const Extraction = z.object({
  vendorName: quoted(z.string()),
  vendorRegistrationNo: quoted(z.string().nullable()),
  invoiceNumber: quoted(z.string()),
  /** YYYY-MM-DD. */
  invoiceDate: quoted(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD")),
  poNumber: quoted(z.string().nullable()),
  /** As printed: RM, MYR, SGD or S$. */
  currency: quoted(z.string()),
  lines: z.array(ExtractedLine).min(1),
  subtotal: quoted(Num),
  taxRate: quoted(Rate.nullable()),
  tax: quoted(Num),
  total: quoted(Num),
  bankName: quoted(z.string().nullable()),
  accountName: quoted(z.string().nullable()),
  accountNumber: quoted(z.string().nullable()),
});

export type Extraction = z.infer<typeof Extraction>;
export type ExtractedLine = z.infer<typeof ExtractedLine>;

/** Parses a model reply: the JSON object in it, checked against the schema. */
export function parseExtraction(
  reply: string,
): { ok: true; value: Extraction } | { ok: false; error: string } {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, error: "The reply has no JSON object." };
  let raw: unknown;
  try {
    raw = JSON.parse(reply.slice(start, end + 1));
  } catch (err) {
    return { ok: false, error: `The JSON doesn't parse: ${(err as Error).message}` };
  }
  const parsed = Extraction.safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: z.prettifyError(parsed.error) };
}
