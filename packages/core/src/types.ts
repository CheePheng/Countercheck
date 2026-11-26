/**
 * The accounts-payable world an invoice is checked against, and the invoice itself.
 * The JSON files written by the Python pipeline (data/world.json, data/truth/*.json)
 * follow these shapes; a test in this package checks that they still do.
 */

export type Currency = "MYR" | "SGD";

export interface BankDetails {
  bankName: string;
  accountName: string;
  accountNumber: string;
}

export interface Vendor {
  id: string;
  name: string;
  registrationNo: string;
  country: "MY" | "SG";
  currency: Currency;
  address: string;
  bank: BankDetails;
}

export interface PoLine {
  lineNo: number;
  sku: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
}

export interface PurchaseOrder {
  number: string;
  vendorId: string;
  date: string;
  currency: Currency;
  /** 0.08 for 8%. */
  taxRate: number;
  lines: PoLine[];
}

export interface GoodsReceipt {
  number: string;
  poNumber: string;
  date: string;
  lines: { sku: string; quantity: number; unit: string }[];
}

/** An invoice already posted to the ledger (or paid before the ledger existed). */
export interface LedgerEntry {
  vendorId: string;
  invoiceNumber: string;
  invoiceDate: string;
  total: number;
  currency: Currency;
  poNumber: string | null;
  lines: { sku: string; quantity: number }[];
  postedOn: string;
}

export interface Buyer {
  name: string;
  registrationNo: string;
  address: string;
}

export interface World {
  buyer: Buyer;
  vendors: Vendor[];
  purchaseOrders: PurchaseOrder[];
  goodsReceipts: GoodsReceipt[];
  ledger: LedgerEntry[];
}

export interface InvoiceLine {
  description: string;
  sku: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  amount: number;
}

/** What an invoice says, as read from the document. */
export interface Invoice {
  vendorName: string;
  vendorRegistrationNo: string | null;
  invoiceNumber: string;
  /** ISO date (YYYY-MM-DD). */
  invoiceDate: string;
  poNumber: string | null;
  /** As printed; matched against the PO's currency. */
  currency: string;
  lines: InvoiceLine[];
  subtotal: number;
  /** 0.08 for 8%, when the invoice states a rate. */
  taxRate: number | null;
  tax: number;
  total: number;
  bank: BankDetails | null;
}

export type Decision = "approve" | "hold" | "reject";

export const REASON_CODES = [
  "UNVERIFIED_FIELD",
  "UNKNOWN_VENDOR",
  "BANK_DETAILS_CHANGED",
  "NO_PO",
  "PO_NOT_FOUND",
  "PO_OTHER_VENDOR",
  "CURRENCY_MISMATCH",
  "NOT_ORDERED",
  "UOM_MISMATCH",
  "PRICE_VARIANCE",
  "SHORT_DELIVERY",
  "LINE_MATH",
  "TAX_MISMATCH",
  "TOTAL_MISMATCH",
  "DUPLICATE_INVOICE",
  "POSSIBLE_DUPLICATE",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export interface Finding {
  code: ReasonCode;
  /** "reject" stops the invoice outright; "hold" sends it to a person. */
  severity: "reject" | "hold";
  /** One plain sentence for the reviewer. */
  message: string;
  /** Path of the invoice field it is about, e.g. "total" or "lines[1].unitPrice". */
  field?: string;
  /** Index into Invoice.lines. */
  line?: number;
  expected?: string;
  actual?: string;
}

/** How one invoice line lines up with the purchase order and the deliveries. */
export interface LineMatch {
  line: number;
  poLine: number | null;
  ordered: number | null;
  received: number | null;
  /** Quantity of this PO line already on posted invoices. */
  alreadyInvoiced: number | null;
  poUnit: string | null;
  poUnitPrice: number | null;
}

export interface CheckResult {
  decision: Decision;
  findings: Finding[];
  vendor: Vendor | null;
  po: PurchaseOrder | null;
  receipts: GoodsReceipt[];
  lines: LineMatch[];
}
