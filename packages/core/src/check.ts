/**
 * The checks an accounts-payable clerk would make, in plain code: who sent it, whether it was
 * ordered and delivered, whether the prices and sums are right, and whether it was paid before.
 * Pure and deterministic, so the same invoice always gets the same decision, in Node, in a
 * Worker or in the browser.
 */
import {
  cents,
  daysBetween,
  descriptionSimilarity,
  formatMoney,
  normalizeAccount,
  normalizeId,
  normalizeName,
  normalizeUnit,
  sameMoney,
} from "./normalize.js";
import type {
  CheckResult,
  Decision,
  Finding,
  GoodsReceipt,
  Invoice,
  InvoiceLine,
  LineMatch,
  PoLine,
  PurchaseOrder,
  Vendor,
  World,
} from "./types.js";

export interface CheckOptions {
  /** A unit price may differ from the PO by this fraction (0.01 = 1%) or by priceToleranceAbs, whichever is larger. */
  priceTolerancePct: number;
  priceToleranceAbs: number;
  /** Same vendor and total under a different number within this many days: a possible duplicate. */
  duplicateWindowDays: number;
  /** Lowest description similarity that matches an invoice line to a PO line without a SKU. */
  minDescriptionSimilarity: number;
}

export const DEFAULT_CHECK_OPTIONS: Readonly<CheckOptions> = Object.freeze({
  priceTolerancePct: 0.01,
  priceToleranceAbs: 0.01,
  duplicateWindowDays: 30,
  minDescriptionSimilarity: 0.5,
});

/** Fields a decision depends on: when their quote can't be confirmed on the page, a person checks them. */
const CRITICAL_FIELD =
  /^(vendorName|invoiceNumber|invoiceDate|poNumber|currency|subtotal|tax|total|bank\.accountNumber|lines\[\d+\]\.(quantity|unit|unitPrice|amount))$/;

export function isCriticalField(field: string): boolean {
  return CRITICAL_FIELD.test(field);
}

/** "RM" and "MYR" are MYR, "S$" and "SGD" are SGD; anything else stays as printed. */
export function normalizeCurrency(printed: string): string {
  const c = printed.toUpperCase().replace(/\s/g, "");
  if (c === "RM" || c === "MYR") return "MYR";
  if (c === "S$" || c === "SGD" || c === "SG$") return "SGD";
  return c;
}

export function findVendor(invoice: Invoice, vendors: readonly Vendor[]): Vendor | null {
  if (invoice.vendorRegistrationNo) {
    const reg = normalizeId(invoice.vendorRegistrationNo);
    const byReg = vendors.find((v) => normalizeId(v.registrationNo) === reg);
    if (byReg) return byReg;
  }
  const name = normalizeName(invoice.vendorName);
  return vendors.find((v) => normalizeName(v.name) === name) ?? null;
}

function matchPoLine(line: InvoiceLine, po: PurchaseOrder, minSimilarity: number): PoLine | null {
  if (line.sku) {
    const sku = normalizeId(line.sku);
    const bySku = po.lines.find((l) => normalizeId(l.sku) === sku);
    if (bySku) return bySku;
  }
  let best: PoLine | null = null;
  let bestScore = minSimilarity;
  for (const candidate of po.lines) {
    const score = descriptionSimilarity(line.description, candidate.description);
    if (score >= bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

export function fieldLabel(field: string): string {
  const line = /^lines\[(\d+)\]\.(\w+)$/.exec(field);
  if (line) {
    const names: Record<string, string> = {
      quantity: "quantity",
      unit: "unit",
      unitPrice: "unit price",
      amount: "amount",
      description: "description",
    };
    return `line ${Number(line[1]) + 1}'s ${names[line[2]!] ?? line[2]}`;
  }
  const labels: Record<string, string> = {
    vendorName: "the vendor name",
    vendorRegistrationNo: "the vendor's registration number",
    invoiceNumber: "the invoice number",
    invoiceDate: "the invoice date",
    poNumber: "the PO number",
    currency: "the currency",
    subtotal: "the subtotal",
    taxRate: "the tax rate",
    tax: "the tax",
    total: "the total",
    "bank.accountNumber": "the bank account number",
    "bank.bankName": "the bank name",
    "bank.accountName": "the account name",
  };
  return labels[field] ?? field;
}

export interface CheckInput {
  invoice: Invoice;
  world: World;
  /** Fields whose quote couldn't be found on the page (from the extraction checks). */
  unverified?: readonly string[];
  options?: Partial<CheckOptions>;
}

export function checkInvoice({
  invoice,
  world,
  unverified = [],
  options,
}: CheckInput): CheckResult {
  const opts: CheckOptions = { ...DEFAULT_CHECK_OPTIONS, ...options };
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(f);

  for (const field of unverified.filter(isCriticalField)) {
    add({
      code: "UNVERIFIED_FIELD",
      severity: "hold",
      field,
      message: `Couldn't confirm ${fieldLabel(field)} on the page, so a person should read it.`,
    });
  }

  // Who sent it.
  const vendor = findVendor(invoice, world.vendors);
  if (!vendor) {
    add({
      code: "UNKNOWN_VENDOR",
      severity: "hold",
      field: "vendorName",
      message: `${invoice.vendorName} isn't on the vendor list.`,
      actual: invoice.vendorName,
    });
  }
  if (
    vendor &&
    invoice.bank &&
    normalizeAccount(invoice.bank.accountNumber) !== normalizeAccount(vendor.bank.accountNumber)
  ) {
    add({
      code: "BANK_DETAILS_CHANGED",
      severity: "hold",
      field: "bank.accountNumber",
      message: `The bank account on this invoice isn't the one on file for ${vendor.name}. Confirm the change with the vendor by phone before paying.`,
      expected: vendor.bank.accountNumber,
      actual: invoice.bank.accountNumber,
    });
  }

  // Paid before?
  const currency = (po: PurchaseOrder | null): string => po?.currency ?? vendor?.currency ?? "";
  if (vendor) {
    const prior = world.ledger.filter((e) => e.vendorId === vendor.id);
    const same = prior.find(
      (e) => normalizeId(e.invoiceNumber) === normalizeId(invoice.invoiceNumber),
    );
    if (same) {
      add({
        code: "DUPLICATE_INVOICE",
        severity: "reject",
        field: "invoiceNumber",
        message: `Invoice ${invoice.invoiceNumber} from ${vendor.name} was already posted on ${same.postedOn}.`,
        actual: invoice.invoiceNumber,
      });
    } else {
      const near = prior.find(
        (e) =>
          sameMoney(e.total, invoice.total) &&
          Math.abs(daysBetween(e.invoiceDate, invoice.invoiceDate)) <= opts.duplicateWindowDays,
      );
      if (near) {
        const days = Math.abs(daysBetween(near.invoiceDate, invoice.invoiceDate));
        add({
          code: "POSSIBLE_DUPLICATE",
          severity: "hold",
          field: "total",
          message: `${vendor.name} billed the same amount, ${formatMoney(near.total, near.currency)}, on invoice ${near.invoiceNumber} ${days} days ${daysBetween(near.invoiceDate, invoice.invoiceDate) >= 0 ? "earlier" : "later"}.`,
          expected: near.invoiceNumber,
          actual: invoice.invoiceNumber,
        });
      }
    }
  }

  // Was it ordered?
  let po: PurchaseOrder | null = null;
  if (!invoice.poNumber) {
    add({
      code: "NO_PO",
      severity: "hold",
      field: "poNumber",
      message: "The invoice doesn't quote a purchase order number.",
    });
  } else {
    const wanted = normalizeId(invoice.poNumber);
    po = world.purchaseOrders.find((p) => normalizeId(p.number) === wanted) ?? null;
    if (!po) {
      add({
        code: "PO_NOT_FOUND",
        severity: "hold",
        field: "poNumber",
        message: `Purchase order ${invoice.poNumber} doesn't exist.`,
        actual: invoice.poNumber,
      });
    } else if (vendor && po.vendorId !== vendor.id) {
      add({
        code: "PO_OTHER_VENDOR",
        severity: "hold",
        field: "poNumber",
        message: `Purchase order ${po.number} was raised for another vendor.`,
        actual: invoice.poNumber,
      });
      po = null;
    }
  }
  if (po && normalizeCurrency(invoice.currency) !== po.currency) {
    add({
      code: "CURRENCY_MISMATCH",
      severity: "hold",
      field: "currency",
      message: `The invoice is in ${invoice.currency}, but purchase order ${po.number} is in ${po.currency}.`,
      expected: po.currency,
      actual: invoice.currency,
    });
  }

  // Line by line against the PO and the deliveries.
  const receipts: GoodsReceipt[] = po
    ? world.goodsReceipts.filter((r) => normalizeId(r.poNumber) === normalizeId(po!.number))
    : [];
  const lines: LineMatch[] = invoice.lines.map((line, i) => {
    const match: LineMatch = {
      line: i,
      poLine: null,
      ordered: null,
      received: null,
      alreadyInvoiced: null,
      poUnit: null,
      poUnitPrice: null,
    };
    if (!po) return match;
    const poLine = matchPoLine(line, po, opts.minDescriptionSimilarity);
    if (!poLine) {
      add({
        code: "NOT_ORDERED",
        severity: "hold",
        field: `lines[${i}].description`,
        line: i,
        message: `"${line.description}" isn't on purchase order ${po.number}.`,
      });
      return match;
    }
    const sku = normalizeId(poLine.sku);
    const received = receipts
      .flatMap((r) => r.lines)
      .filter((l) => normalizeId(l.sku) === sku)
      .reduce((sum, l) => sum + l.quantity, 0);
    // A re-sent copy of a posted invoice is a duplicate; it doesn't also use up its own deliveries.
    const isThisInvoice = (e: World["ledger"][number]) =>
      vendor !== null &&
      e.vendorId === vendor.id &&
      normalizeId(e.invoiceNumber) === normalizeId(invoice.invoiceNumber);
    const alreadyInvoiced = world.ledger
      .filter(
        (e) =>
          e.poNumber && normalizeId(e.poNumber) === normalizeId(po!.number) && !isThisInvoice(e),
      )
      .flatMap((e) => e.lines)
      .filter((l) => normalizeId(l.sku) === sku)
      .reduce((sum, l) => sum + l.quantity, 0);
    Object.assign(match, {
      poLine: poLine.lineNo,
      ordered: poLine.quantity,
      received,
      alreadyInvoiced,
      poUnit: poLine.unit,
      poUnitPrice: poLine.unitPrice,
    });

    if (normalizeUnit(line.unit) !== normalizeUnit(poLine.unit)) {
      add({
        code: "UOM_MISMATCH",
        severity: "hold",
        field: `lines[${i}].unit`,
        line: i,
        message: `Line ${i + 1} is billed per ${line.unit}, but the PO orders it per ${poLine.unit}.`,
        expected: poLine.unit,
        actual: line.unit,
      });
      return match;
    }
    const tolerance = Math.max(opts.priceToleranceAbs, poLine.unitPrice * opts.priceTolerancePct);
    if (Math.abs(line.unitPrice - poLine.unitPrice) > tolerance + 1e-9) {
      add({
        code: "PRICE_VARIANCE",
        severity: "hold",
        field: `lines[${i}].unitPrice`,
        line: i,
        message: `Line ${i + 1} costs ${formatMoney(line.unitPrice, currency(po))} a unit; the PO agreed ${formatMoney(poLine.unitPrice, currency(po))}.`,
        expected: String(poLine.unitPrice),
        actual: String(line.unitPrice),
      });
    }
    const available = received - alreadyInvoiced;
    if (line.quantity > available) {
      add({
        code: "SHORT_DELIVERY",
        severity: "hold",
        field: `lines[${i}].quantity`,
        line: i,
        message:
          alreadyInvoiced > 0
            ? `Line ${i + 1} bills ${line.quantity}, but only ${received} were received and ${alreadyInvoiced} of those are already billed.`
            : `Line ${i + 1} bills ${line.quantity}, but only ${received} were received.`,
        expected: String(available),
        actual: String(line.quantity),
      });
    }
    return match;
  });

  // The sums.
  invoice.lines.forEach((line, i) => {
    if (!sameMoney(cents(line.quantity * line.unitPrice), line.amount)) {
      add({
        code: "LINE_MATH",
        severity: "hold",
        field: `lines[${i}].amount`,
        line: i,
        message: `Line ${i + 1}: ${line.quantity} × ${formatMoney(line.unitPrice)} is ${formatMoney(cents(line.quantity * line.unitPrice))}, not ${formatMoney(line.amount)}.`,
        expected: String(cents(line.quantity * line.unitPrice)),
        actual: String(line.amount),
      });
    }
  });
  const sum = cents(invoice.lines.reduce((s, l) => s + l.amount, 0));
  if (!sameMoney(sum, invoice.subtotal)) {
    add({
      code: "TOTAL_MISMATCH",
      severity: "hold",
      field: "subtotal",
      message: `The lines add up to ${formatMoney(sum)}, but the subtotal says ${formatMoney(invoice.subtotal)}.`,
      expected: String(sum),
      actual: String(invoice.subtotal),
    });
  }
  const rate = po?.taxRate ?? invoice.taxRate;
  if (rate !== null && rate !== undefined) {
    const expectedTax = cents(invoice.subtotal * rate);
    if (!sameMoney(expectedTax, invoice.tax)) {
      add({
        code: "TAX_MISMATCH",
        severity: "hold",
        field: "tax",
        message: `Tax at ${Math.round(rate * 1000) / 10}% of ${formatMoney(invoice.subtotal)} is ${formatMoney(expectedTax)}, not ${formatMoney(invoice.tax)}.`,
        expected: String(expectedTax),
        actual: String(invoice.tax),
      });
    }
  }
  if (!sameMoney(cents(invoice.subtotal + invoice.tax), invoice.total)) {
    add({
      code: "TOTAL_MISMATCH",
      severity: "hold",
      field: "total",
      message: `Subtotal plus tax is ${formatMoney(cents(invoice.subtotal + invoice.tax))}, not ${formatMoney(invoice.total)}.`,
      expected: String(cents(invoice.subtotal + invoice.tax)),
      actual: String(invoice.total),
    });
  }

  const ordered = [
    ...findings.filter((f) => f.severity === "reject"),
    ...findings.filter((f) => f.severity === "hold"),
  ];
  const decision: Decision = ordered.some((f) => f.severity === "reject")
    ? "reject"
    : ordered.length > 0
      ? "hold"
      : "approve";
  return { decision, findings: ordered, vendor, po, receipts, lines };
}

/** The distinct reason codes of a result, sorted: what evals compare. */
export function reasonCodes(result: Pick<CheckResult, "findings">): string[] {
  return [...new Set(result.findings.map((f) => f.code))].sort();
}
