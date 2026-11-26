# Countercheck pipeline

The Python side of Countercheck: it generates the synthetic world (vendors, purchase orders, goods
receipts, the ledger) and the sample invoices, renders them to PDF, extracts their text layer, and
keeps the known answers apart from everything the model sees.

```bash
uv sync
uv run countercheck-data          # writes ../data
uv run pytest
```

Everything is deterministic from a seed: the same seed gives byte-identical JSON and PDFs.

Output, relative to the repository root:

- `data/world.json`: the vendor master, purchase orders, goods receipts and posted invoices.
- `data/cases.json`: the sample invoices (id, dev or held-out split, layout, files).
- `data/cases/<id>.pdf`, `<id>.webp` and `<id>.page.json`: the invoice, a picture of it, and its
  text layer with word positions. The text layer is what the model reads.
- `data/truth/<id>.json`: the known answer (fields, decision, reasons). Never sent to the model.

All companies, people, addresses and bank details are invented.
