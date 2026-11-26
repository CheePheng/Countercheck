from __future__ import annotations

import copy

from countercheck_pipeline.evals import same, score, summarize

TRUTH = {
    "id": "inv-99",
    "situation": "price_variance",
    "decision": "hold",
    "reasons": ["PRICE_VARIANCE"],
    "invoice": {
        "vendorName": "Orchidfold Packaging Sdn Bhd",
        "vendorRegistrationNo": "201901012345 (1312345-A)",
        "invoiceNumber": "OF-01278",
        "invoiceDate": "2026-10-24",
        "poNumber": "PO-264369",
        "currency": "RM",
        "lines": [{"description": "Bag", "sku": None, "quantity": 9, "unit": "pack", "unitPrice": 70.0, "amount": 630.0}],
        "subtotal": 630.0,
        "taxRate": 0.1,
        "tax": 63.0,
        "total": 693.0,
        "bank": {"bankName": "Selatan Commercial Bank", "accountName": "Orchidfold Packaging Sdn Bhd", "accountNumber": "5140-2231-0098"},
    },
}


def reading(decision: str = "hold", codes: tuple[str, ...] = ("PRICE_VARIANCE",)) -> dict:
    inv = TRUTH["invoice"]
    q = lambda v: {"value": v, "quote": "x"}  # noqa: E731
    extraction = {k: q(inv[k]) for k in ("vendorName", "vendorRegistrationNo", "invoiceNumber", "invoiceDate", "poNumber", "currency", "subtotal", "taxRate", "tax", "total")}
    extraction |= {k: q(inv["bank"][k]) for k in ("bankName", "accountName", "accountNumber")}
    extraction["lines"] = [dict(line, quote="x") for line in inv["lines"]]
    return {
        "extraction": extraction,
        "verification": {"checks": [], "unverified": []},
        "result": {"decision": decision, "findings": [{"code": c} for c in codes], "lines": []},
        "neurons": 30.5,
        "latencyMs": 12000,
        "attempts": 1,
    }


def test_compares_like_a_clerk_would() -> None:
    assert same("total", 693, 693.004)
    assert not same("total", 693, 693.02)
    assert same("invoiceNumber", "of 01278", "OF-01278")
    assert same("vendorName", "ORCHIDFOLD  Packaging Sdn Bhd", "Orchidfold Packaging Sdn Bhd")
    assert same("poNumber", None, None) and not same("poNumber", "PO-1", None)


def test_a_perfect_reading_scores_full_marks() -> None:
    row = score(reading(), TRUTH, "dev")
    assert row["wrong"] == [] and row["fieldsRight"] == row["fieldsTotal"] == 13 + 4
    assert row["decisionRight"] and row["reasonsRight"] and not row["falseApproval"]


def test_wrong_fields_are_named() -> None:
    r = reading()
    r["extraction"]["total"]["value"] = 639.0
    r["extraction"]["lines"][0]["quantity"] = 8
    assert score(r, TRUTH, "dev")["wrong"] == ["total", "lines[0].quantity"]


def test_approving_an_invoice_that_should_stop_is_a_false_approval() -> None:
    row = score(reading("approve", ()), TRUTH, "test")
    assert row["falseApproval"] and not row["decisionRight"]


def test_a_failed_reading_is_held_not_approved() -> None:
    row = score(None, TRUTH, "dev")
    assert row["decision"] == "hold" and not row["read"] and row["fieldsRight"] == 0
    approve = copy.deepcopy(TRUTH) | {"decision": "approve", "reasons": []}
    assert score(None, approve, "dev")["falseHold"]


def test_summary_counts() -> None:
    rows = [score(reading(), TRUTH, "dev"), score(reading("approve", ()), TRUTH, "dev")]
    s = summarize(rows)
    assert s["invoices"] == 2 and s["decisionsRight"] == 1 and s["falseApprovals"] == 1
    assert s["neuronsPerInvoice"] == 30.5 and s["secondsP50"] == 12.0
