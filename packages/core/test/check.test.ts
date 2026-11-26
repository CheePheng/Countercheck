import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkInvoice, type Invoice, reasonCodes, type World } from "../src/index.js";

const world: World = {
  buyer: { name: "Lantern Street Cafés Sdn Bhd", registrationNo: "202001000001", address: "JB" },
  vendors: [
    {
      id: "V1",
      name: "Orchidfold Packaging Sdn Bhd",
      registrationNo: "201901012345",
      country: "MY",
      currency: "MYR",
      address: "12 Jalan Contoh 3, Johor Bahru",
      bank: {
        bankName: "Selatan Commercial Bank",
        accountName: "Orchidfold Packaging Sdn Bhd",
        accountNumber: "5140-2231-0098",
      },
    },
    {
      id: "V2",
      name: "Lumora Kitchenware Pte Ltd",
      registrationNo: "201812345K",
      country: "SG",
      currency: "SGD",
      address: "8 Rekaan Road, Singapore",
      bank: {
        bankName: "Straits Harbour Bank",
        accountName: "Lumora Kitchenware Pte Ltd",
        accountNumber: "771-203344-1",
      },
    },
  ],
  purchaseOrders: [
    {
      number: "PO-1001",
      vendorId: "V1",
      date: "2026-09-20",
      currency: "MYR",
      taxRate: 0.08,
      lines: [
        {
          lineNo: 1,
          sku: "PKG-CUP-12",
          description: "Paper cup 12oz, carton of 1000",
          quantity: 10,
          unit: "carton",
          unitPrice: 185,
        },
        {
          lineNo: 2,
          sku: "PKG-LID-12",
          description: "Cup lid 12oz, carton of 1000",
          quantity: 10,
          unit: "carton",
          unitPrice: 92,
        },
      ],
    },
    {
      number: "PO-2001",
      vendorId: "V2",
      date: "2026-09-22",
      currency: "SGD",
      taxRate: 0.09,
      lines: [
        {
          lineNo: 1,
          sku: "KW-PAN-28",
          description: "Frying pan 28cm",
          quantity: 6,
          unit: "pcs",
          unitPrice: 42.5,
        },
      ],
    },
  ],
  goodsReceipts: [
    {
      number: "GRN-1",
      poNumber: "PO-1001",
      date: "2026-10-02",
      lines: [
        { sku: "PKG-CUP-12", quantity: 10, unit: "carton" },
        { sku: "PKG-LID-12", quantity: 8, unit: "carton" },
      ],
    },
  ],
  ledger: [
    {
      vendorId: "V1",
      invoiceNumber: "OP-2210",
      invoiceDate: "2026-10-01",
      total: 1000,
      currency: "MYR",
      poNumber: null,
      lines: [],
      postedOn: "2026-10-03",
    },
  ],
};

/** A correct invoice for what PO-1001 delivered: 10 cartons of cups, 8 of lids. */
function clean(): Invoice {
  return {
    vendorName: "Orchidfold Packaging Sdn Bhd",
    vendorRegistrationNo: "201901012345",
    invoiceNumber: "OP-2301",
    invoiceDate: "2026-10-05",
    poNumber: "PO-1001",
    currency: "RM",
    lines: [
      {
        description: "Paper cup 12oz, carton of 1000",
        sku: "PKG-CUP-12",
        quantity: 10,
        unit: "ctn",
        unitPrice: 185,
        amount: 1850,
      },
      {
        description: "Cup lid 12oz, carton of 1000",
        sku: "PKG-LID-12",
        quantity: 8,
        unit: "carton",
        unitPrice: 92,
        amount: 736,
      },
    ],
    subtotal: 2586,
    taxRate: 0.08,
    tax: 206.88,
    total: 2792.88,
    bank: {
      bankName: "Selatan Commercial Bank",
      accountName: "Orchidfold Packaging Sdn Bhd",
      accountNumber: "5140 2231 0098",
    },
  };
}

const check = (invoice: Invoice, unverified: string[] = []) =>
  checkInvoice({ invoice, world, unverified });
const resum = (inv: Invoice) => {
  inv.subtotal = Math.round(inv.lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  inv.tax = Math.round(inv.subtotal * 0.08 * 100) / 100;
  inv.total = Math.round((inv.subtotal + inv.tax) * 100) / 100;
  return inv;
};

describe("checkInvoice", () => {
  it("proposes approval for an invoice that matches the PO, the delivery and the sums", () => {
    const r = check(clean());
    expect(r.findings).toEqual([]);
    expect(r.decision).toBe("approve");
    expect(r.vendor?.id).toBe("V1");
    expect(r.po?.number).toBe("PO-1001");
    expect(r.lines.map((l) => [l.poLine, l.received, l.alreadyInvoiced])).toEqual([
      [1, 10, 0],
      [2, 8, 0],
    ]);
  });

  it("matches vendor names and ids loosely", () => {
    const inv = clean();
    inv.vendorName = "ORCHIDFOLD PACKAGING SDN. BHD.";
    inv.vendorRegistrationNo = null;
    inv.poNumber = "po 1001";
    expect(check(inv).decision).toBe("approve");
  });

  it("holds a unit price above the PO's", () => {
    const inv = clean();
    inv.lines[0]!.unitPrice = 190;
    inv.lines[0]!.amount = 1900;
    const r = check(resum(inv));
    expect(reasonCodes(r)).toEqual(["PRICE_VARIANCE"]);
    expect(r.findings[0]!.message).toContain("MYR 185.00");
  });

  it("allows a price within the tolerance", () => {
    const inv = clean();
    inv.lines[0]!.unitPrice = 186.5; // within 1% of 185
    inv.lines[0]!.amount = 1865;
    expect(check(resum(inv)).decision).toBe("approve");
  });

  it("holds billing for more than was delivered", () => {
    const inv = clean();
    inv.lines[1]!.quantity = 10;
    inv.lines[1]!.amount = 920;
    const r = check(resum(inv));
    expect(reasonCodes(r)).toEqual(["SHORT_DELIVERY"]);
    expect(r.findings[0]!.message).toBe("Line 2 bills 10, but only 8 were received.");
  });

  it("counts quantities already billed on earlier invoices", () => {
    const partial: World = {
      ...world,
      ledger: [
        ...world.ledger,
        {
          vendorId: "V1",
          invoiceNumber: "OP-2290",
          invoiceDate: "2026-10-03",
          // Four lids and two cartons of cups: a different total from the invoices below.
          total: 797.04,
          currency: "MYR",
          poNumber: "PO-1001",
          lines: [
            { sku: "PKG-LID-12", quantity: 4 },
            { sku: "PKG-CUP-12", quantity: 2 },
          ],
          postedOn: "2026-10-04",
        },
      ],
    };
    const inv: Invoice = {
      ...clean(),
      lines: [{ ...clean().lines[1]!, quantity: 4, amount: 368 }],
    };
    expect(checkInvoice({ invoice: resum(inv), world: partial }).decision).toBe("approve");
    const over: Invoice = {
      ...clean(),
      lines: [{ ...clean().lines[1]!, quantity: 5, amount: 460 }],
    };
    const r = checkInvoice({ invoice: resum(over), world: partial });
    expect(reasonCodes(r)).toEqual(["SHORT_DELIVERY"]);
    expect(r.findings[0]!.message).toContain("4 of those are already billed");
  });

  it("rejects an invoice number that was already posted", () => {
    const inv = clean();
    inv.invoiceNumber = "op 2210";
    const r = check(inv);
    expect(r.decision).toBe("reject");
    expect(reasonCodes(r)).toEqual(["DUPLICATE_INVOICE"]);
  });

  it("holds the same amount billed again under a new number", () => {
    const inv: Invoice = {
      ...clean(),
      lines: [
        {
          description: "Paper cup 12oz, carton of 1000",
          sku: "PKG-CUP-12",
          quantity: 5,
          unit: "carton",
          unitPrice: 185,
          amount: 925.93,
        },
      ],
      subtotal: 925.93,
      tax: 74.07,
      total: 1000,
    };
    const r = check(inv);
    expect(reasonCodes(r)).toContain("POSSIBLE_DUPLICATE");
    expect(r.findings.find((f) => f.code === "POSSIBLE_DUPLICATE")!.message).toContain("OP-2210");
  });

  it("holds changed bank details", () => {
    const inv = clean();
    inv.bank = { ...inv.bank!, accountNumber: "8800-1234-5678" };
    const r = check(inv);
    expect(reasonCodes(r)).toEqual(["BANK_DETAILS_CHANGED"]);
    expect(r.findings[0]!.expected).toBe("5140-2231-0098");
  });

  it("holds a missing, unknown or someone else's PO", () => {
    expect(reasonCodes(check({ ...clean(), poNumber: null }))).toEqual(["NO_PO"]);
    expect(reasonCodes(check({ ...clean(), poNumber: "PO-9999" }))).toEqual(["PO_NOT_FOUND"]);
    expect(reasonCodes(check({ ...clean(), poNumber: "PO-2001" }))).toEqual(["PO_OTHER_VENDOR"]);
  });

  it("holds a currency that isn't the PO's", () => {
    expect(reasonCodes(check({ ...clean(), currency: "SGD" }))).toEqual(["CURRENCY_MISMATCH"]);
    expect(check({ ...clean(), currency: "MYR" }).decision).toBe("approve");
  });

  it("holds a line billed in a different unit", () => {
    const inv = clean();
    inv.lines[0]!.unit = "pcs";
    expect(reasonCodes(check(inv))).toEqual(["UOM_MISMATCH"]);
  });

  it("holds a line that was never ordered", () => {
    const inv = clean();
    inv.lines.push({
      description: "Paper straw 6mm",
      sku: null,
      quantity: 2,
      unit: "carton",
      unitPrice: 60,
      amount: 120,
    });
    expect(reasonCodes(check(resum(inv)))).toEqual(["NOT_ORDERED"]);
  });

  it("matches a line without a SKU by its description", () => {
    const inv = clean();
    inv.lines[0]!.sku = null;
    inv.lines[0]!.description = "Paper cups 12oz (carton of 1000)";
    expect(check(inv).decision).toBe("approve");
  });

  it("checks the arithmetic", () => {
    const tax = clean();
    tax.tax = 258.6; // 10%, not the PO's 8%
    tax.total = 2844.6;
    expect(reasonCodes(check(tax))).toEqual(["TAX_MISMATCH"]);
    const line = clean();
    line.lines[0]!.amount = 1580;
    expect(reasonCodes(check(line))).toEqual(["LINE_MATH", "TOTAL_MISMATCH"]);
    const total = clean();
    total.total = 2829.88;
    expect(reasonCodes(check(total))).toEqual(["TOTAL_MISMATCH"]);
  });

  it("holds when a critical field couldn't be confirmed on the page", () => {
    const r = check(clean(), ["total", "bank.bankName"]);
    expect(reasonCodes(r)).toEqual(["UNVERIFIED_FIELD"]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.message).toContain("the total");
  });

  it("puts rejections first and decides from the worst finding", () => {
    const inv = clean();
    inv.invoiceNumber = "OP-2210";
    inv.bank = { ...inv.bank!, accountNumber: "1" };
    const r = check(inv);
    expect(r.findings.map((f) => f.severity)).toEqual(["reject", "hold"]);
    expect(r.decision).toBe("reject");
  });

  it("approves any consistent invoice for delivered goods at PO prices", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 0, max: 8 }),
        fc.boolean(),
        (cups, lids, rm) => {
          fc.pre(cups + lids > 0);
          const lines = [
            cups > 0 ? { ...clean().lines[0]!, quantity: cups, amount: cups * 185 } : null,
            lids > 0 ? { ...clean().lines[1]!, quantity: lids, amount: lids * 92 } : null,
          ].filter((l) => l !== null);
          const inv = resum({ ...clean(), currency: rm ? "RM" : "MYR", lines });
          // A total equal to an earlier invoice's within 30 days is a legitimate hold.
          fc.pre(inv.total !== 1000);
          return check(inv).decision === "approve";
        },
      ),
    );
  });

  it("decides consistently with its findings for any edit", () => {
    fc.assert(
      fc.property(
        fc.record({
          price: fc.double({ min: 0, max: 400, noNaN: true }),
          qty: fc.integer({ min: 0, max: 20 }),
          poNumber: fc.constantFrom("PO-1001", "PO-2001", "PO-404", null),
          account: fc.constantFrom("5140-2231-0098", "0000"),
        }),
        ({ price, qty, poNumber, account }) => {
          const inv = clean();
          inv.lines[0]!.unitPrice = price;
          inv.lines[0]!.quantity = qty;
          inv.lines[0]!.amount = Math.round(qty * price * 100) / 100;
          inv.poNumber = poNumber;
          inv.bank = { ...inv.bank!, accountNumber: account };
          const r = check(resum(inv));
          const expected = r.findings.some((f) => f.severity === "reject")
            ? "reject"
            : r.findings.length > 0
              ? "hold"
              : "approve";
          return r.decision === expected;
        },
      ),
    );
  });
});
