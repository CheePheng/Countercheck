"""The text layer of a rendered invoice: words with positions, grouped into lines.

The model reads `text` (the lines joined top to bottom). The app uses the word boxes to draw
highlighter marks over the picture of the page where a quoted value appears.
"""

from __future__ import annotations

from pathlib import Path

import pdfplumber

LINE_TOLERANCE = 2.5  # points: words whose tops differ by less sit on the same line


def _box(item: dict) -> dict:
    return {k: round(float(item[k]), 2) for k in ("x0", "x1", "top", "bottom")}


def text_layer(pdf_path: Path) -> dict:
    with pdfplumber.open(pdf_path) as pdf:
        page = pdf.pages[0]
        raw = page.extract_words(x_tolerance=1.5, y_tolerance=2, keep_blank_chars=False)
        width, height = float(page.width), float(page.height)

    raw.sort(key=lambda w: (round(float(w["top"]) / LINE_TOLERANCE), float(w["x0"])))
    words: list[dict] = []
    lines: list[dict] = []
    current: list[dict] = []

    def close() -> None:
        if not current:
            return
        current.sort(key=lambda w: w["x0"])
        start = len(words)
        words.extend(current)
        lines.append(
            {
                "text": " ".join(w["text"] for w in current),
                "x0": min(w["x0"] for w in current),
                "x1": max(w["x1"] for w in current),
                "top": min(w["top"] for w in current),
                "bottom": max(w["bottom"] for w in current),
                "words": [start, len(words)],
            }
        )
        current.clear()

    for w in raw:
        word = {"text": w["text"], **_box(w)}
        if current and abs(word["top"] - current[0]["top"]) > LINE_TOLERANCE:
            close()
        current.append(word)
    close()
    lines.sort(key=lambda line: (line["top"], line["x0"]))
    return {
        "width": round(width, 2),
        "height": round(height, 2),
        "text": "\n".join(line["text"] for line in lines),
        "lines": lines,
        "words": words,
    }
