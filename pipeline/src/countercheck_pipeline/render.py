"""Prints a draft invoice to PDF in one of four layouts (one with Malay labels).

`invariant=1` keeps reportlab's output byte-identical for the same input.
"""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .cases import Draft
from .models import Buyer

MONTHS_EN = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
MONTHS_MS = ("Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ogos", "Sep", "Okt", "Nov", "Dis")
INK = colors.HexColor("#1d1d1f")
MUTED = colors.HexColor("#5b5b60")
RULE = colors.HexColor("#c9c9ce")


def money(value: Decimal) -> str:
    """1,850.00; unit prices keep up to four decimals (0.0778)."""
    if value == value.quantize(Decimal("0.01")):
        return f"{value:,.2f}"
    return f"{value:,.4f}".rstrip("0")


def qty(value: Decimal) -> str:
    return f"{int(value):,}" if value == value.to_integral_value() else f"{value.normalize()}"


def rate(value: Decimal) -> str:
    return f"{(value * 100).normalize():f}%"


def printed_date(draft: Draft) -> str:
    d = draft.issued
    if draft.layout == "ledger":
        return d.strftime("%d/%m/%Y")
    if draft.layout == "banner":
        return f"{d.day} {MONTHS_EN[d.month - 1]} {d.year}"
    if draft.layout == "malay":
        return f"{d.day} {MONTHS_MS[d.month - 1]} {d.year}"
    return d.isoformat()


def _styles(accent: colors.Color) -> dict[str, ParagraphStyle]:
    base = ParagraphStyle("base", fontName="Helvetica", fontSize=9, leading=12, textColor=INK)
    return {
        "base": base,
        "small": ParagraphStyle("small", parent=base, fontSize=8, leading=10.5, textColor=MUTED),
        "vendor": ParagraphStyle("vendor", parent=base, fontName="Helvetica-Bold", fontSize=15, leading=18),
        "title": ParagraphStyle(
            "title", parent=base, fontName="Helvetica-Bold", fontSize=18, leading=22, textColor=accent, alignment=TA_RIGHT
        ),
        "right": ParagraphStyle("right", parent=base, alignment=TA_RIGHT),
        "center": ParagraphStyle("center", parent=base, alignment=TA_CENTER),
        "note": ParagraphStyle("note", parent=base, fontName="Helvetica-Bold", textColor=colors.HexColor("#9b1c1c")),
        "banner": ParagraphStyle(
            "banner", parent=base, fontName="Helvetica-Bold", fontSize=17, leading=21, textColor=colors.white
        ),
        "banner_right": ParagraphStyle(
            "banner_right", parent=base, fontName="Helvetica-Bold", fontSize=12, textColor=colors.white, alignment=TA_RIGHT
        ),
    }


def _p(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(text, style)


def _address(draft: Draft) -> str:
    v = draft.vendor
    lines = [escape(a) for a in v.address]
    return "<br/>".join([*lines, f"Reg. No: {escape(v.registration_no)}", f"Tel: {v.phone}   {v.email}"])


def _grid(
    rows: list[list], widths: list[float], header: bool, accent: colors.Color, right_from: int, center: int | None = None
) -> Table:
    table = Table(rows, colWidths=widths, repeatRows=1 if header else 0)
    style = [
        ("FONT", (0, 0), (-1, -1), "Helvetica", 9),
        ("TEXTCOLOR", (0, 0), (-1, -1), INK),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (right_from, 0), (-1, -1), "RIGHT"),
        *([("ALIGN", (center, 0), (center, -1), "CENTER")] if center is not None else []),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if header:
        style += [
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8.5),
            ("TEXTCOLOR", (0, 0), (-1, 0), accent),
            ("LINEBELOW", (0, 0), (-1, 0), 1, accent),
        ]
    table.setStyle(TableStyle(style))
    return table


def _totals(labels: tuple[str, str, str], draft: Draft, accent: colors.Color, width: float) -> Table:
    tax_label = f"{draft.vendor.tax_label} {rate(draft.tax_rate)}"
    rows = [
        [labels[0], money(draft.subtotal)],
        [labels[1].format(tax=tax_label), money(draft.tax)],
        [labels[2].format(cur=draft.currency_label), money(draft.total)],
    ]
    table = Table(rows, colWidths=[width * 0.62, width * 0.38], hAlign="RIGHT")
    table.setStyle(
        TableStyle(
            [
                ("FONT", (0, 0), (-1, -1), "Helvetica", 9),
                ("FONT", (0, 2), (-1, 2), "Helvetica-Bold", 10.5),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                ("LINEABOVE", (0, 2), (-1, 2), 1, accent),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    return table


def _bank(draft: Draft, labels: tuple[str, str, str, str], s: dict[str, ParagraphStyle]) -> list:
    out: list = [Spacer(1, 8 * mm)]
    if draft.note:
        out += [_p(escape(draft.note), s["note"]), Spacer(1, 2 * mm)]
    out.append(
        _p(
            f"<b>{labels[0]}</b><br/>{labels[1]}: {escape(draft.bank_name)}<br/>"
            f"{labels[2]}: {escape(draft.vendor.name)}<br/>{labels[3]}: {escape(draft.account_number)}",
            s["base"],
        )
    )
    return out


def _ledger_like(draft: Draft, buyer: Buyer, malay: bool) -> list:
    accent = colors.HexColor(draft.vendor.accent)
    s = _styles(accent)
    L = (
        dict(
            title="INVOIS CUKAI",
            number="No. Invois",
            date="Tarikh",
            po="No. Pesanan Belian (PO)",
            terms=("Terma", "30 hari"),
            bill="Kepada",
            cols=("Bil", "Perihal", "Kuantiti", "Unit", "Harga Seunit ({cur})", "Jumlah ({cur})"),
            totals=("Jumlah Kecil", "{tax}", "Jumlah Besar ({cur})"),
            bank=("Butiran Pembayaran", "Bank", "Nama Akaun", "No. Akaun"),
            thanks="Terima kasih atas sokongan anda.",
        )
        if malay
        else dict(
            title="TAX INVOICE",
            number="Invoice No.",
            date="Date",
            po="PO No.",
            terms=("Terms", "30 days"),
            bill="Bill to",
            cols=("No.", "Description", "Qty", "Unit", "Unit Price ({cur})", "Amount ({cur})"),
            totals=("Subtotal", "{tax}", "Total ({cur})"),
            bank=("Payment details", "Bank", "Account name", "Account no."),
            thanks="Thank you for your business.",
        )
    )
    meta = [[L["number"], draft.number], [L["date"], printed_date(draft)]]
    if draft.po_number:
        meta.append([L["po"], draft.po_number])
    meta.append(list(L["terms"]))
    meta_table = Table(meta, colWidths=[38 * mm, 36 * mm], hAlign="RIGHT")
    meta_table.setStyle(
        TableStyle(
            [
                ("FONT", (0, 0), (-1, -1), "Helvetica", 9),
                ("FONT", (0, 0), (0, -1), "Helvetica-Bold", 9),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )
    head = Table(
        [[_p(escape(draft.vendor.name), s["vendor"]), _p(L["title"], s["title"])], [_p(_address(draft), s["small"]), meta_table]],
        colWidths=[100 * mm, 74 * mm],
    )
    head.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    cur = draft.currency_label
    rows = [[c.format(cur=cur) for c in L["cols"]]]
    for i, line in enumerate(draft.lines, start=1):
        rows.append([str(i), _p(escape(line.description), s["base"]), qty(line.quantity), line.unit, money(line.unit_price), money(line.amount)])
    return [
        head,
        Spacer(1, 7 * mm),
        _p(f"<b>{L['bill']}</b><br/>{escape(buyer.name)}<br/>{escape(buyer.address)}", s["base"]),
        Spacer(1, 6 * mm),
        _grid(rows, [10 * mm, 62 * mm, 18 * mm, 16 * mm, 34 * mm, 34 * mm], True, accent, 2, center=3),
        Spacer(1, 4 * mm),
        _totals(L["totals"], draft, accent, 74 * mm),
        *_bank(draft, L["bank"], s),
        Spacer(1, 6 * mm),
        _p(L["thanks"], s["small"]),
    ]


def ledger(draft: Draft, buyer: Buyer) -> list:
    return _ledger_like(draft, buyer, malay=False)


def malay(draft: Draft, buyer: Buyer) -> list:
    return _ledger_like(draft, buyer, malay=True)


def banner(draft: Draft, buyer: Buyer) -> list:
    accent = colors.HexColor(draft.vendor.accent)
    s = _styles(accent)
    band = Table([[_p(escape(draft.vendor.name), s["banner"]), _p("INVOICE", s["banner_right"])]], colWidths=[124 * mm, 50 * mm])
    band.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), accent),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 9),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    details = [
        f"Number: <b>{escape(draft.number)}</b>",
        f"Issued: {printed_date(draft)}",
        *([f"Purchase order: {escape(draft.po_number)}"] if draft.po_number else []),
        f"Currency: {draft.currency_label}",
    ]
    parties = Table(
        [
            [
                _p(f"<b>Billed to</b><br/>{escape(buyer.name)}<br/>{escape(buyer.address)}", s["base"]),
                _p("<b>Invoice details</b><br/>" + "<br/>".join(details), s["base"]),
            ],
            [_p(_address(draft), s["small"]), ""],
        ],
        colWidths=[100 * mm, 74 * mm],
    )
    parties.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    rows = [["SKU", "Item", "Qty", "UOM", "Price", "Line total"]]
    for line in draft.lines:
        rows.append([line.item.sku, _p(escape(line.description), s["base"]), qty(line.quantity), line.unit, money(line.unit_price), money(line.amount)])
    due = Table(
        [[f"Amount due ({draft.currency_label})", money(draft.total)]], colWidths=[50 * mm, 34 * mm], hAlign="RIGHT"
    )
    due.setStyle(
        TableStyle(
            [
                ("FONT", (0, 0), (-1, -1), "Helvetica-Bold", 12),
                ("TEXTCOLOR", (0, 0), (-1, -1), accent),
                ("ALIGN", (1, 0), (1, 0), "RIGHT"),
            ]
        )
    )
    return [
        band,
        Spacer(1, 6 * mm),
        parties,
        Spacer(1, 6 * mm),
        _grid(rows, [26 * mm, 70 * mm, 16 * mm, 16 * mm, 22 * mm, 24 * mm], True, accent, 2, center=3),
        Spacer(1, 4 * mm),
        _totals(("Subtotal", "{tax}", "Total ({cur})"), draft, accent, 84 * mm),
        Spacer(1, 3 * mm),
        due,
        *_bank(draft, ("Remit to", "Bank", "Account name", "Account number"), s),
    ]


def receipt(draft: Draft, buyer: Buyer) -> list:
    accent = colors.HexColor(draft.vendor.accent)
    s = _styles(accent)
    width = 112 * mm
    head = [
        _p(f"<b>{escape(draft.vendor.name)}</b>", ParagraphStyle("rv", parent=s["center"], fontSize=12, leading=15)),
        _p(_address(draft), ParagraphStyle("ra", parent=s["small"], alignment=TA_CENTER)),
        Spacer(1, 4 * mm),
        _p("<b>INVOICE</b>", ParagraphStyle("rt", parent=s["center"], fontSize=11, textColor=accent)),
        _p(
            f"No: {escape(draft.number)}<br/>Date: {printed_date(draft)}"
            + (f"<br/>PO: {escape(draft.po_number)}" if draft.po_number else "")
            + f"<br/>Customer: {escape(buyer.name)}",
            s["center"],
        ),
        Spacer(1, 4 * mm),
    ]
    rows = []
    for line in draft.lines:
        rows.append([_p(f"{qty(line.quantity)} {line.unit}  {escape(line.description)}", s["base"]), money(line.amount)])
        rows.append([_p(f"@ {draft.currency_label} {money(line.unit_price)} / {line.unit}", s["small"]), ""])
    items = Table(rows, colWidths=[width * 0.72, width * 0.28], hAlign="CENTER")
    items.setStyle(
        TableStyle(
            [
                ("FONT", (0, 0), (-1, -1), "Helvetica", 9),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 1),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
            ]
        )
    )
    totals = _totals(("Subtotal", "{tax}", "TOTAL {cur}"), draft, accent, width)
    totals.hAlign = "CENTER"
    bank_lines = _bank(draft, ("Pay to", "Bank", "Name", "Acct"), s)
    return [*head, items, Spacer(1, 3 * mm), totals, *bank_lines]


LAYOUT_FNS = {"ledger": ledger, "malay": malay, "banner": banner, "receipt": receipt}


def render(path: Path, draft: Draft, buyer: Buyer) -> None:
    doc = SimpleDocTemplate(
        str(path),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        invariant=1,
        title=f"Invoice {draft.number}",
        author=draft.vendor.name,
        creator="Countercheck sample data",
    )
    doc.build(LAYOUT_FNS[draft.layout](draft, buyer))
