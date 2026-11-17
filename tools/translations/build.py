#!/usr/bin/env python3
"""Build data/translations-jp.csv from the Civitai Danbooru translations.

Primary source: v2.0 Full (danbooru_translations_jp_anima29.csv, extracted
as v2_translations_jp.csv). Gaps are filled from the v1-based file
(danbooru_translations_jp.csv, via the note.com app distribution).
Only the first Japanese term of each entry is kept (the rest are search
aliases with noise), and only tags present in data/danbooru.csv are emitted.
"""
import csv
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
JP = re.compile(r"[぀-ヿ一-鿿]")


def load(path):
    d = {}
    with open(path, encoding="utf-8-sig", newline="") as f:
        for r in csv.reader(f):
            if len(r) >= 2:
                d[r[0].strip()] = r[1].strip()
    return d


def first_jp(d, tag):
    v = d.get(tag)
    if not v:
        return None
    for part in v.split(","):
        p = part.strip()
        if JP.search(p):
            return p
    return None


def main():
    v2 = load(HERE / "v2_translations_jp.csv")
    v1 = load(HERE / "danbooru_translations_jp.csv")
    ours = []
    with open(ROOT / "data" / "danbooru.csv", encoding="utf-8", newline="") as f:
        for r in csv.reader(f):
            if len(r) >= 3:
                ours.append(r[0])
    rows = []
    from_v1 = 0
    for tag in ours:
        fj = first_jp(v2, tag)
        if fj is None:
            fj = first_jp(v1, tag)
            if fj is not None:
                from_v1 += 1
        if fj is not None:
            rows.append((tag, fj))
    out = ROOT / "data" / "translations-jp.csv"
    with open(out, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerows(rows)
    print(f"wrote {out}: {len(rows)} entries ({from_v1} filled from v1), "
          f"{out.stat().st_size} bytes")


if __name__ == "__main__":
    sys.exit(main())
