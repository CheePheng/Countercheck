"""`countercheck-data`: writes the world, the sample invoices and their known answers."""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import pypdfium2 as pdfium

from .cases import Built, build_all
from .models import BankDetails, CaseInfo, Truth, Vendor, World
from .render import render
from .seeds import BUYER, VENDORS
from .textlayer import text_layer

REPO = Path(__file__).resolve().parents[3]
DEFAULT_SEED = 20261126


def _write_json(path: Path, data: object) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


def _picture(pdf_path: Path, out: Path) -> None:
    pdf = pdfium.PdfDocument(str(pdf_path))
    try:
        image = pdf[0].render(scale=1.6).to_pil()
        image.save(out, "WEBP", quality=82, method=6)
    finally:
        pdf.close()


def _world(built: list[Built]) -> World:
    vendors = [
        Vendor(
            id=v.id,
            name=v.name,
            registration_no=v.registration_no,
            country=v.country,  # type: ignore[arg-type]
            currency=v.currency,  # type: ignore[arg-type]
            address=", ".join(v.address),
            bank=BankDetails(bank_name=v.bank_name, account_name=v.name, account_number=v.account_number),
        )
        for v in VENDORS
    ]
    pos = sorted((po for b in built for po in b.pos), key=lambda p: p.number)
    grns = sorted((g for b in built for g in b.receipts), key=lambda g: g.number)
    ledger = sorted((e for b in built for e in b.ledger), key=lambda e: (e.posted_on, e.invoice_number))
    return World(buyer=BUYER, vendors=vendors, purchase_orders=pos, goods_receipts=grns, ledger=ledger)


def generate(out: Path, seed: int = DEFAULT_SEED) -> list[CaseInfo]:
    built = build_all(seed)
    order = list(range(len(built)))
    random.Random(seed + 1).shuffle(order)  # ids say nothing about the situation or the split

    cases_dir = out / "cases"
    truth_dir = out / "truth"
    for folder in (cases_dir, truth_dir):
        folder.mkdir(parents=True, exist_ok=True)
        for old in folder.iterdir():
            if old.suffix in {".pdf", ".webp", ".json"}:
                old.unlink()

    infos: list[CaseInfo] = []
    for position, index in enumerate(order, start=1):
        b = built[index]
        case_id = f"inv-{position:02d}"
        pdf_path = cases_dir / f"{case_id}.pdf"
        render(pdf_path, b.draft, BUYER)
        _write_json(cases_dir / f"{case_id}.page.json", text_layer(pdf_path))
        _picture(pdf_path, cases_dir / f"{case_id}.webp")
        truth = Truth(
            id=case_id, situation=b.situation, invoice=b.draft.invoice(), decision=b.decision, reasons=sorted(b.reasons)
        )
        _write_json(truth_dir / f"{case_id}.json", truth.dump())
        infos.append(
            CaseInfo(
                id=case_id,
                split="dev" if b.variant == 0 else "test",
                layout=b.draft.layout,
                pdf=f"cases/{case_id}.pdf",
                image=f"cases/{case_id}.webp",
                page=f"cases/{case_id}.page.json",
            )
        )
    infos.sort(key=lambda c: c.id)
    _write_json(out / "cases.json", [c.dump() for c in infos])
    _write_json(out / "world.json", _world(built).dump())
    return infos


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--out", type=Path, default=REPO / "data")
    args = parser.parse_args(argv)
    infos = generate(args.out, args.seed)
    dev = sum(1 for c in infos if c.split == "dev")
    print(f"Wrote {len(infos)} invoices ({dev} dev, {len(infos) - dev} held out) to {args.out}")


if __name__ == "__main__":
    main()
