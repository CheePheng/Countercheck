"""The sample invoices: situations an accounts-payable clerk meets, each with its known answer.

Every situation is built twice, with different vendors and layouts: variant 0 goes to the dev set
(for iterating on prompts) and variant 1 to the held-out test set (for reported numbers).
"""

from __future__ import annotations

import random
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from .models import (
    BankDetails,
    GoodsReceipt,
    Invoice,
    InvoiceLine,
    LedgerEntry,
    LedgerLine,
    PoLine,
    PurchaseOrder,
    ReceiptLine,
)
from .seeds import OTHER_BANKS, VENDOR_BY_ID, VENDORS, Item, VendorSeed

CENT = Decimal("0.01")
LAYOUTS = ("ledger", "banner", "receipt", "malay")
# Layouts that print a SKU column.
SKU_LAYOUTS = {"banner"}


def money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


_WORD = re.compile(r"[a-z0-9]+")
_STOP = {"of", "the", "and", "for", "with", "a", "x", "per", "dan", "untuk"}


def similarity(a: str, b: str) -> float:
    """The same word overlap as descriptionSimilarity in packages/core."""

    def words(s: str) -> set[str]:
        return {w for w in _WORD.findall(s.lower()) if w not in _STOP and len(w) > 1}

    wa, wb = words(a), words(b)
    if not wa or not wb:
        return 0.0
    shared = len(wa & wb)
    return shared / (len(wa) + len(wb) - shared)


@dataclass
class DraftLine:
    item: Item
    description: str
    quantity: Decimal
    unit: str
    unit_price: Decimal

    @property
    def amount(self) -> Decimal:
        return money(self.quantity * self.unit_price)


@dataclass
class Draft:
    """An invoice before it is printed: its fields plus what only the page needs."""

    vendor: VendorSeed
    number: str
    issued: date
    po_number: str | None
    currency_label: str
    lines: list[DraftLine]
    tax_rate: Decimal
    bank_name: str
    account_number: str
    note: str | None = None
    layout: str = "ledger"

    @property
    def subtotal(self) -> Decimal:
        return sum((line.amount for line in self.lines), Decimal(0))

    @property
    def tax(self) -> Decimal:
        return money(self.subtotal * self.tax_rate)

    @property
    def total(self) -> Decimal:
        return self.subtotal + self.tax

    def invoice(self) -> Invoice:
        """The known answer for the fields, as printed."""
        shows_sku = self.layout in SKU_LAYOUTS
        return Invoice(
            vendor_name=self.vendor.name,
            vendor_registration_no=self.vendor.registration_no,
            invoice_number=self.number,
            invoice_date=self.issued.isoformat(),
            po_number=self.po_number,
            currency=self.currency_label,
            lines=[
                InvoiceLine(
                    description=line.description,
                    sku=line.item.sku if shows_sku else None,
                    quantity=float(line.quantity),
                    unit=line.unit,
                    unit_price=float(line.unit_price),
                    amount=float(line.amount),
                )
                for line in self.lines
            ],
            subtotal=float(self.subtotal),
            tax_rate=float(self.tax_rate),
            tax=float(self.tax),
            total=float(self.total),
            bank=BankDetails(
                bank_name=self.bank_name,
                account_name=self.vendor.name,
                account_number=self.account_number,
            ),
        )


@dataclass
class Built:
    situation: str
    variant: int
    draft: Draft
    pos: list[PurchaseOrder] = field(default_factory=list)
    receipts: list[GoodsReceipt] = field(default_factory=list)
    ledger: list[LedgerEntry] = field(default_factory=list)
    decision: str = "approve"
    reasons: list[str] = field(default_factory=list)


class Ctx:
    """Random choices and running numbers, all from one seed."""

    def __init__(self, seed: int) -> None:
        self.rng = random.Random(seed)
        self.po_seq = 4100 + self.rng.randint(0, 200)
        self.grn_seq = 88000 + self.rng.randint(0, 900)
        self.inv_seq = {v.id: 1000 + self.rng.randint(0, 8000) for v in VENDORS}

    def po_number(self) -> str:
        self.po_seq += self.rng.randint(1, 9)
        return f"PO-26{self.po_seq:04d}"

    def grn_number(self) -> str:
        self.grn_seq += self.rng.randint(1, 17)
        return f"GRN-{self.grn_seq}"

    def invoice_number(self, vendor: VendorSeed) -> str:
        self.inv_seq[vendor.id] += self.rng.randint(3, 40)
        return f"{vendor.invoice_prefix}{self.inv_seq[vendor.id]:05d}"

    def after(self, start: date, low: int, high: int) -> date:
        return start + timedelta(days=self.rng.randint(low, high))

    def order_date(self) -> date:
        return self.after(date(2026, 9, 1), 0, 60)

    def quantity(self, item: Item) -> int:
        return self.rng.randint(5, 30) if item.unit == "kg" else self.rng.randint(2, 24)

    def account_number(self) -> str:
        digits = "".join(str(self.rng.randint(0, 9)) for _ in range(12))
        return f"{digits[:4]}-{digits[4:8]}-{digits[8:]}"


def _currency_label(vendor: VendorSeed, layout: str) -> str:
    if vendor.currency == "MYR":
        return "MYR" if layout == "banner" else "RM"
    return "S$" if layout == "receipt" else "SGD"


def _order(ctx: Ctx, vendor: VendorSeed, items: list[Item], when: date) -> PurchaseOrder:
    return PurchaseOrder(
        number=ctx.po_number(),
        vendor_id=vendor.id,
        date=when.isoformat(),
        currency=vendor.currency,  # type: ignore[arg-type]
        tax_rate=float(vendor.tax_rate),
        lines=[
            PoLine(
                line_no=i + 1,
                sku=item.sku,
                description=item.description,
                quantity=ctx.quantity(item),
                unit=item.unit,
                unit_price=float(item.price),
            )
            for i, item in enumerate(items)
        ],
    )


def _receive(ctx: Ctx, po: PurchaseOrder, qty: dict[str, int], when: date) -> GoodsReceipt:
    return GoodsReceipt(
        number=ctx.grn_number(),
        po_number=po.number,
        date=when.isoformat(),
        lines=[
            ReceiptLine(sku=line.sku, quantity=qty[line.sku], unit=line.unit)
            for line in po.lines
            if qty.get(line.sku, 0) > 0
        ],
    )


def _bill(
    ctx: Ctx, vendor: VendorSeed, po: PurchaseOrder, qty: dict[str, int], issued: date, layout: str
) -> Draft:
    items = {item.sku: item for item in vendor.items}
    return Draft(
        vendor=vendor,
        number=ctx.invoice_number(vendor),
        issued=issued,
        po_number=po.number,
        currency_label=_currency_label(vendor, layout),
        lines=[
            DraftLine(
                item=items[line.sku],
                description=line.description,
                quantity=Decimal(qty[line.sku]),
                unit=line.unit,
                unit_price=Decimal(str(line.unit_price)),
            )
            for line in po.lines
            if qty.get(line.sku, 0) > 0
        ],
        tax_rate=vendor.tax_rate,
        bank_name=vendor.bank_name,
        account_number=vendor.account_number,
        layout=layout,
    )


def _posted(draft: Draft, posted_on: date) -> LedgerEntry:
    return LedgerEntry(
        vendor_id=draft.vendor.id,
        invoice_number=draft.number,
        invoice_date=draft.issued.isoformat(),
        total=float(draft.total),
        currency=draft.vendor.currency,  # type: ignore[arg-type]
        po_number=draft.po_number,
        lines=[LedgerLine(sku=line.item.sku, quantity=int(line.quantity)) for line in draft.lines],
        posted_on=posted_on.isoformat(),
    )


def _pick_items(ctx: Ctx, vendor: VendorSeed, low: int = 1, high: int = 3, keep_out: int = 0) -> list[Item]:
    count = ctx.rng.randint(low, min(high, len(vendor.items) - keep_out))
    return ctx.rng.sample(list(vendor.items), count)


def _full(po: PurchaseOrder) -> dict[str, int]:
    return {line.sku: line.quantity for line in po.lines}


def _simple(ctx: Ctx, vendor: VendorSeed, layout: str, items: list[Item] | None = None):
    """Order, receive everything, invoice everything: the common path."""
    po = _order(ctx, vendor, items or _pick_items(ctx, vendor), ctx.order_date())
    received = ctx.after(date.fromisoformat(po.date), 3, 9)
    grn = _receive(ctx, po, _full(po), received)
    draft = _bill(ctx, vendor, po, _full(po), ctx.after(received, 0, 4), layout)
    return po, grn, draft


# --------------------------------------------------------------------------- situations


def clean(ctx: Ctx, vendor: VendorSeed, layout: str) -> Built:
    po, grn, draft = _simple(ctx, vendor, layout)
    return Built("clean", 0, draft, [po], [grn])


def price_variance(ctx: Ctx, vendor: VendorSeed, layout: str) -> Built:
    po, grn, draft = _simple(ctx, vendor, layout)
    line = ctx.rng.choice(draft.lines)
    line.unit_price = money(line.unit_price * Decimal(ctx.rng.choice(["1.06", "1.08", "1.10", "1.12"])))
    return Built("price_variance", 0, draft, [po], [grn], decision="hold", reasons=["PRICE_VARIANCE"])


def short_delivery(ctx: Ctx, vendor: VendorSeed, layout: str) -> Built:
    po = _order(ctx, vendor, _pick_items(ctx, vendor), ctx.order_date())
    short = ctx.rng.choice(po.lines)
    short.quantity = max(short.quantity, 4)
    got = _full(po)
    got[short.sku] = short.quantity - ctx.rng.randint(1, max(1, short.quantity // 4))
    received = ctx.after(date.fromisoformat(po.date), 3, 9)
    grn = _receive(ctx, po, got, received)
    draft = _bill(ctx, vendor, po, _full(po), ctx.after(received, 0, 4), layout)
    return Built("short_delivery", 0, draft, [po], [grn], decision="hold", reasons=["SHORT_DELIVERY"])


def partial_second(ctx: Ctx, vendor: VendorSeed, layout: str) -> Built:
    """Two deliveries, each invoiced; the first invoice is already posted, this is the second."""
    po = _order(ctx, vendor, _pick_items(ctx, vendor, 1, 2), ctx.order_date())
    first: dict[str, int] = {}
    second: dict[str, int] = {}
    for line in po.lines:
        line.quantity = max(line.quantity, 6)
        first[line.sku] = ctx.rng.randint(2, line.quantity - 2)
        second[line.sku] = line.quantity - first[line.sku]
    d1 = ctx.after(date.fromisoformat(po.date), 3, 6)
    d2 = ctx.after(d1, 5, 10)
    grns = [_receive(ctx, po, first, d1), _receive(ctx, po, second, d2)]
    earlier = _bill(ctx, vendor, po, first, ctx.after(d1, 0, 2), layout)
    draft = _bill(ctx, vendor, po, second, ctx.after(d2, 0, 3), layout)
    if earlier.total == draft.total:  # would also read as a possible duplicate
        return partial_second(ctx, vendor, layout)
    built = Built("partial_second", 0, draft, [po], grns, [_posted(earlier, ctx.after(earlier.issued, 1, 3))])
    return built


def duplicate_number(ctx: Ctx, vendor: VendorSeed, layout: str) -> Built:
    """The same invoice sent again after it was posted."""
    po, grn, draft = _simple(ctx, vendor, layout)
    posted = _posted(draft, ctx.after(draft.issued, 2, 5))
    return Built("duplicate_number", 0, draft, [po], [grn], [posted], "reject", ["DUPLICATE_INVOICE"])


def possible_duplicate(ctx: Ctx, vendor: VendorSeed, layout: str) -> Built:
    """A repeat order billed for exactly the same amount within weeks: genuine, or billed twice?"""
    items = _pick_items(ctx, vendor)
    po_a, grn_a, bill_a = _simple(ctx, vendor, layout, items)
    po_b = _order(ctx, vendor, items, ctx.after(date.fromisoformat(po_a.date), 6, 12))
    for line_b, line_a in zip(po_b.lines, po_a.lines, strict=True):
        line_b.quantity = line_a.quantity
    received = ctx.after(date.fromisoformat(po_b.date), 3, 6)
    grn_b = _receive(ctx, po_b, _full(po_b), received)
    draft = _bill(ctx, vendor, po_b, _full(po_b), ctx.after(received, 0, 3), layout)
    posted = _posted(bill_a, ctx.after(bill_a.issued, 1, 3))
    return Built(
        "possible_duplicate", 0, draft, [po_a, po_b], [grn_a, grn_b], [posted], "hold", ["POSSIBLE_DUPLICATE"]
    )


def tax_mismatch(ctx: Ctx, vendor: VendorSeed, layout: str) -> Built:
    """Tax at a rate that isn't the PO's (an old GST rate, or the wrong SST rate)."""
    po, grn, draft = _simple(ctx, vendor, layout)
    draft.tax_rate = Decimal("0.08") if vendor.tax_rate != Decimal("0.08") else Decimal("0.06")
    return Built("tax_mismatch", 0, draft, [po], [grn], decision="hold", reasons=["TAX_MISMATCH"])


def no_po(ctx: Ctx, vendor: VendorSeed, layout: str) -> Built:
    po, grn, draft = _simple(ctx, vendor, layout)
    draft.po_number = None
    return Built("no_po", 0, draft, [po], [grn], decision="hold", reasons=["NO_PO"])


def uom_mismatch(ctx: Ctx, vendor: VendorSeed, layout: str) -> Built:
    """Ordered by the box, billed by the piece."""
    boxed = [item for item in vendor.items if item.pieces]
    item = ctx.rng.choice(boxed)
    others = [i for i in vendor.items if i is not item]
    items = [item, *ctx.rng.sample(others, ctx.rng.randint(0, min(1, len(others))))]
    po, grn, draft = _simple(ctx, vendor, layout, items)
    line = next(line for line in draft.lines if line.item is item)
    assert item.pieces is not None
    line.quantity = line.quantity * item.pieces
    line.unit = "pcs"
    line.unit_price = line.unit_price / item.pieces
    return Built("uom_mismatch", 0, draft, [po], [grn], decision="hold", reasons=["UOM_MISMATCH"])


def currency_mismatch(ctx: Ctx, vendor: VendorSeed, layout: str) -> Built:
    po, grn, draft = _simple(ctx, vendor, layout)
    draft.currency_label = "RM" if vendor.currency == "SGD" else "SGD"
    return Built("currency_mismatch", 0, draft, [po], [grn], decision="hold", reasons=["CURRENCY_MISMATCH"])


def bank_changed(ctx: Ctx, vendor: VendorSeed, layout: str) -> Built:
    """New bank details on an otherwise normal invoice: the usual payment-fraud pattern."""
    po, grn, draft = _simple(ctx, vendor, layout)
    draft.bank_name = ctx.rng.choice([b for b in OTHER_BANKS if b != vendor.bank_name])
    draft.account_number = ctx.account_number()
    draft.note = (
        "Sila ambil perhatian: butiran bank kami telah bertukar, berkuat kuasa serta-merta."
        if layout == "malay"
        else "Please note our bank details have changed, effective immediately."
    )
    return Built("bank_changed", 0, draft, [po], [grn], decision="hold", reasons=["BANK_DETAILS_CHANGED"])


def not_ordered(ctx: Ctx, vendor: VendorSeed, layout: str) -> Built:
    """An extra line for something the PO never asked for."""
    for _ in range(50):
        items = _pick_items(ctx, vendor, 1, 2, keep_out=1)
        extras = [
            i for i in vendor.items if i not in items and all(similarity(i.description, o.description) < 0.3 for o in items)
        ]
        if extras:
            break
    else:  # pragma: no cover - the catalogs always allow one
        raise RuntimeError(f"no unrelated item for {vendor.id}")
    po, grn, draft = _simple(ctx, vendor, layout, items)
    extra = ctx.rng.choice(extras)
    draft.lines.append(
        DraftLine(extra, extra.description, Decimal(ctx.rng.randint(1, 6)), extra.unit, extra.price)
    )
    return Built("not_ordered", 0, draft, [po], [grn], decision="hold", reasons=["NOT_ORDERED"])


MY_TAXED = [v.id for v in VENDORS if v.country == "MY" and v.tax_rate > 0]
SG = [v.id for v in VENDORS if v.country == "SG"]
ALL = [v.id for v in VENDORS]

PLAN = (
    (clean, "clean", MY_TAXED),
    (clean, "clean_sg", SG),
    (clean, "clean_zero_tax", ["V02"]),
    (price_variance, "price_variance", ALL),
    (short_delivery, "short_delivery", ALL),
    (partial_second, "partial_second", ALL),
    (duplicate_number, "duplicate_number", ALL),
    (possible_duplicate, "possible_duplicate", ALL),
    (tax_mismatch, "tax_mismatch", [v.id for v in VENDORS if v.tax_rate > 0]),
    (no_po, "no_po", ALL),
    (uom_mismatch, "uom_mismatch", [v.id for v in VENDORS if any(i.pieces for i in v.items)]),
    (currency_mismatch, "currency_mismatch", ALL),
    (bank_changed, "bank_changed", ALL),
    (not_ordered, "not_ordered", [v.id for v in VENDORS if len(v.items) >= 3]),
)


def build_all(seed: int) -> list[Built]:
    """Every situation twice (variant 0 for dev, 1 for the held-out set)."""
    ctx = Ctx(seed)
    used: Counter[str] = Counter()
    built: list[Built] = []
    for make, situation, allowed in PLAN:
        vendor_ids = ctx.rng.sample(allowed, 2) if len(allowed) >= 2 else allowed * 2
        for variant, vendor_id in enumerate(vendor_ids):
            vendor = VENDOR_BY_ID[vendor_id]
            options = [l for l in LAYOUTS if l != "malay" or vendor.country == "MY"]
            least = min(used[l] for l in options)
            layout = ctx.rng.choice([l for l in options if used[l] == least])
            used[layout] += 1
            b = make(ctx, vendor, layout)
            b.situation, b.variant = situation, variant
            built.append(b)
    return built
