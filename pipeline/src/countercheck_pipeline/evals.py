"""`countercheck-evals`: reads the sample invoices through the API and scores the readings.

    uv run countercheck-evals --model baseline                    # the template parser, free
    uv run countercheck-evals --model gemma-4 --split dev         # costs neurons
    uv run countercheck-evals --model gemma-4 --cases inv-03,inv-07 --no-save

Every reading is saved unedited to data/readings/<model>/<case>.json (the app replays them),
and the scores to data/evals/<model>.json. The headline number is false approvals: invoices
that should have been stopped but would have been paid.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from .cli import REPO

HEADER_FIELDS = (
    "vendorName",
    "vendorRegistrationNo",
    "invoiceNumber",
    "invoiceDate",
    "poNumber",
    "currency",
    "subtotal",
    "taxRate",
    "tax",
    "total",
    "bankName",
    "accountName",
    "accountNumber",
)
NUMBERS = {"subtotal", "tax", "total", "quantity", "unitPrice", "amount"}
IDS = {"invoiceNumber", "poNumber", "accountNumber", "vendorRegistrationNo"}


def known_value(invoice: dict, field: str) -> object:
    bank = invoice.get("bank") or {}
    return {"bankName": bank.get("bankName"), "accountName": bank.get("accountName"), "accountNumber": bank.get("accountNumber")}.get(
        field, invoice.get(field)
    )


def same(field: str, got: object, want: object) -> bool:
    if got is None or want is None:
        return got is None and want is None
    if field == "taxRate":
        return abs(float(got) - float(want)) < 1e-6  # type: ignore[arg-type]
    if field in NUMBERS:
        return abs(float(got) - float(want)) <= 0.005  # type: ignore[arg-type]
    if field in IDS:
        return re.sub(r"[^A-Z0-9]", "", str(got).upper()) == re.sub(r"[^A-Z0-9]", "", str(want).upper())
    return " ".join(str(got).lower().split()) == " ".join(str(want).lower().split())


def score(reading: dict | None, truth: dict, split: str) -> dict:
    """One sample invoice: which fields were read right, and whether the decision was right."""
    known = truth["invoice"]
    extraction = (reading or {}).get("extraction")
    wrong: list[str] = []
    if extraction:
        for field in HEADER_FIELDS:
            if not same(field, extraction[field]["value"], known_value(known, field)):
                wrong.append(field)
        got_lines, want_lines = extraction["lines"], known["lines"]
        if len(got_lines) != len(want_lines):
            wrong.append("lines.count")
        for i, (g, w) in enumerate(zip(got_lines, want_lines)):
            for k in ("quantity", "unit", "unitPrice", "amount"):
                if not same(k, g[k], w[k]):
                    wrong.append(f"lines[{i}].{k}")
    fields_total = len(HEADER_FIELDS) + 4 * len(known["lines"])
    result = (reading or {}).get("result")
    # A reading that failed is held: the app sends what it can't read to a person.
    decision = result["decision"] if result else "hold"
    reasons = sorted({f["code"] for f in result["findings"]}) if result else []
    return {
        "id": truth["id"],
        "split": split,
        "situation": truth["situation"],
        "read": extraction is not None,
        "fieldsTotal": fields_total,
        "fieldsRight": fields_total - len([w for w in wrong if w != "lines.count"]) if extraction else 0,
        "wrong": wrong,
        "unverified": ((reading or {}).get("verification") or {}).get("unverified", []),
        "decision": decision,
        "knownDecision": truth["decision"],
        "reasons": reasons,
        "knownReasons": truth["reasons"],
        "decisionRight": decision == truth["decision"],
        "reasonsRight": reasons == truth["reasons"],
        "falseApproval": decision == "approve" and truth["decision"] != "approve",
        "falseHold": decision != "approve" and truth["decision"] == "approve",
        "neurons": (reading or {}).get("neurons", 0),
        "latencyMs": (reading or {}).get("latencyMs"),
        "attempts": (reading or {}).get("attempts", 0),
    }


def summarize(rows: list[dict]) -> dict:
    latencies = sorted(r["latencyMs"] for r in rows if r["latencyMs"] is not None)

    def pct(p: float) -> float | None:
        if not latencies:
            return None
        return latencies[min(len(latencies) - 1, round(p * (len(latencies) - 1)))] / 1000

    return {
        "invoices": len(rows),
        "read": sum(r["read"] for r in rows),
        "fieldAccuracy": round(sum(r["fieldsRight"] for r in rows) / max(1, sum(r["fieldsTotal"] for r in rows)), 4),
        "allFieldsRight": sum(1 for r in rows if r["read"] and not r["wrong"]),
        "decisionsRight": sum(r["decisionRight"] for r in rows),
        "reasonsRight": sum(r["reasonsRight"] for r in rows),
        "falseApprovals": sum(r["falseApproval"] for r in rows),
        "falseHolds": sum(r["falseHold"] for r in rows),
        "neurons": round(sum(r["neurons"] for r in rows), 1),
        "neuronsPerInvoice": round(statistics.fmean(r["neurons"] for r in rows), 1) if rows else 0,
        "secondsP50": pct(0.5),
        "secondsP95": pct(0.95),
    }


def _post(base: str, body: dict, key: str | None) -> tuple[int, dict]:
    headers = {"content-type": "application/json"}
    if key:
        headers["x-countercheck-recorder"] = key
    req = urllib.request.Request(f"{base}/api/read", data=json.dumps(body).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=180) as res:
            return res.status, json.loads(res.read())
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read() or b"{}")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base", default="http://localhost:5190")
    parser.add_argument("--model", default="gemma-4")
    parser.add_argument("--split", choices=("dev", "test", "all"), default="all")
    parser.add_argument("--cases", help="comma-separated ids; overrides --split")
    parser.add_argument("--no-save", action="store_true", help="score only; keep earlier readings and results")
    parser.add_argument("--data", type=Path, default=REPO / "data")
    args = parser.parse_args(argv)
    key = os.environ.get("COUNTERCHECK_RECORDER_KEY")

    cases = json.loads((args.data / "cases.json").read_text(encoding="utf-8"))
    if args.cases:
        wanted = set(args.cases.split(","))
        cases = [c for c in cases if c["id"] in wanted]
    elif args.split != "all":
        cases = [c for c in cases if c["split"] == args.split]

    readings_dir = args.data / "readings" / args.model
    if not args.no_save:
        readings_dir.mkdir(parents=True, exist_ok=True)
    rows: list[dict] = []
    failures: list[dict] = []
    for case in cases:
        truth = json.loads((args.data / "truth" / f"{case['id']}.json").read_text(encoding="utf-8"))
        status, body = _post(args.base, {"case": case["id"], "model": args.model}, key)
        if status != 200:
            message = body.get("error", {}).get("message", body)
            print(f"{case['id']}: HTTP {status} {message}")
            if status in (429, 503):  # out of allowance or limits: stop rather than score failures
                break
            # Kept in the results for good, even after a later run reads the invoice.
            failures.append({"id": case["id"], "status": status, "message": str(message), "at": _now()})
            continue
        body.pop("meter", None)
        if not args.no_save:
            (readings_dir / f"{case['id']}.json").write_text(json.dumps(body, indent=1) + "\n", encoding="utf-8", newline="\n")
        row = score(body, truth, case["split"])
        rows.append(row)
        mark = "ok " if row["decisionRight"] and not row["wrong"] else ("FA " if row["falseApproval"] else "-- ")
        print(
            f"{mark}{case['id']} {case['split']:4} {truth['situation']:18} {row['decision']:7} (known {row['knownDecision']:7})"
            f" wrong={','.join(row['wrong']) or '-'} {row['neurons']:.0f} n {(row['latencyMs'] or 0) / 1000:.1f} s"
        )
        if args.model != "baseline":
            time.sleep(0.5)

    for row in rows:
        row["runAt"] = _now()
    if args.no_save or not (rows or failures):
        print(json.dumps(summaries(rows), indent=1))
        return
    # Merge with the last results: a partial run replaces only the invoices it read.
    out = args.data / "evals"
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"{args.model}.json"
    previous = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    merged = {r["id"]: r for r in previous.get("cases", [])}
    merged.update({r["id"]: r for r in rows})
    all_rows = sorted(merged.values(), key=lambda r: r["id"])
    first = next((json.loads((readings_dir / f"{r['id']}.json").read_text(encoding="utf-8")) for r in rows), {})
    result = {
        "model": first.get("model") or previous.get("model") or {"key": args.model, "label": args.model},
        "promptVersion": first.get("promptVersion") or previous.get("promptVersion"),
        "runAt": _now(),
        "invoices": [r["id"] for r in all_rows],
        "summary": summaries(all_rows),
        "failures": previous.get("failures", []) + failures,
        "cases": all_rows,
    }
    path.write_text(json.dumps(result, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(result["summary"], indent=1))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def summaries(rows: list[dict]) -> dict:
    by_split = {s: summarize([r for r in rows if r["split"] == s]) for s in ("dev", "test") if any(r["split"] == s for r in rows)}
    return {"all": summarize(rows), **by_split}


if __name__ == "__main__":
    main()
