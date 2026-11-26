from __future__ import annotations

import json
import re
from collections import Counter
from decimal import Decimal
from pathlib import Path

import pytest

from countercheck_pipeline.cases import PLAN
from countercheck_pipeline.cli import generate

REASONS = {
    "UNVERIFIED_FIELD", "UNKNOWN_VENDOR", "BANK_DETAILS_CHANGED", "NO_PO", "PO_NOT_FOUND", "PO_OTHER_VENDOR",
    "CURRENCY_MISMATCH", "NOT_ORDERED", "UOM_MISMATCH", "PRICE_VARIANCE", "SHORT_DELIVERY", "LINE_MATH",
    "TAX_MISMATCH", "TOTAL_MISMATCH", "DUPLICATE_INVOICE", "POSSIBLE_DUPLICATE",
}  # fmt: skip
REAL_BANKS = re.compile(
    r"maybank|cimb|public bank|rhb|hong leong|ambank|dbs|ocbc|uob|hsbc|standard chartered|citibank|bank islam|affin|alliance",
    re.I,
)


@pytest.fixture(scope="module")
def data(tmp_path_factory: pytest.TempPathFactory) -> Path:
    out = tmp_path_factory.mktemp("data")
    generate(out)
    return out


def load(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def truths(data: Path) -> list[dict]:
    return [load(p) for p in sorted((data / "truth").glob("*.json"))]  # type: ignore[misc]


def test_same_seed_same_bytes(data: Path, tmp_path: Path) -> None:
    generate(tmp_path)
    for path in sorted(data.rglob("*")):
        if path.is_file() and path.suffix in {".json", ".pdf"}:
            assert (tmp_path / path.relative_to(data)).read_bytes() == path.read_bytes(), path.name


def test_every_situation_in_both_splits(data: Path) -> None:
    cases = {c["id"]: c for c in load(data / "cases.json")}  # type: ignore[union-attr]
    seen = Counter((t["situation"], cases[t["id"]]["split"]) for t in truths(data))
    for _, situation, _ in PLAN:
        assert seen[(situation, "dev")] == 1 and seen[(situation, "test")] == 1, situation


def test_ids_say_nothing(data: Path) -> None:
    ids = [c["id"] for c in load(data / "cases.json")]  # type: ignore[union-attr]
    assert all(re.fullmatch(r"inv-\d{2}", i) for i in ids)
    assert len(ids) == len(set(ids)) == 2 * len(PLAN)


def test_model_inputs_hold_no_answers(data: Path) -> None:
    situations = {s for _, s, _ in PLAN}
    for path in [data / "cases.json", *(data / "cases").glob("*.page.json")]:
        text = path.read_text(encoding="utf-8")
        assert not any(code in text for code in REASONS), path.name
        assert not any(f'"{s}"' in text for s in situations), path.name
        assert "situation" not in text and "decision" not in text, path.name


def test_known_answers_add_up(data: Path) -> None:
    for t in truths(data):
        inv = t["invoice"]
        cents = lambda v: Decimal(str(v)).quantize(Decimal("0.01"))  # noqa: E731
        for line in inv["lines"]:
            assert cents(Decimal(str(line["quantity"])) * Decimal(str(line["unitPrice"]))) == cents(line["amount"]), t["id"]
        assert sum(cents(line["amount"]) for line in inv["lines"]) == cents(inv["subtotal"]), t["id"]
        assert cents(Decimal(str(inv["subtotal"])) * Decimal(str(inv["taxRate"]))) == cents(inv["tax"]), t["id"]
        assert cents(inv["subtotal"]) + cents(inv["tax"]) == cents(inv["total"]), t["id"]
        assert set(t["reasons"]) <= REASONS and t["decision"] in {"approve", "hold", "reject"}


def test_the_page_shows_what_the_answer_says(data: Path) -> None:
    for t in truths(data):
        page = load(data / "cases" / f"{t['id']}.page.json")
        text = page["text"]  # type: ignore[index]
        inv = t["invoice"]
        assert inv["invoiceNumber"] in text, t["id"]
        assert f"{Decimal(str(inv['total'])):,.2f}" in text, t["id"]
        assert inv["bank"]["accountNumber"] in text, t["id"]
        if inv["poNumber"]:
            assert inv["poNumber"] in text, t["id"]
        else:
            assert "PO-26" not in text, t["id"]
        for word in page["words"]:  # type: ignore[index]
            assert 0 <= word["x0"] < word["x1"] <= page["width"] and 0 <= word["top"] < word["bottom"] <= page["height"]  # type: ignore[index]


def test_everyone_is_invented(data: Path) -> None:
    world = load(data / "world.json")
    banks = [v["bank"]["bankName"] for v in world["vendors"]]  # type: ignore[index]
    banks += [t["invoice"]["bank"]["bankName"] for t in truths(data)]
    assert not any(REAL_BANKS.search(b) for b in banks), banks
    emails = re.findall(r"[\w.]+@[\w.]+", (data / "cases" / "inv-01.page.json").read_text(encoding="utf-8"))
    assert all(e.endswith(".example") for e in emails), emails
