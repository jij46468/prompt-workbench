#!/usr/bin/env python3
"""Danbooru Wiki tag_groups とその配下ページを API で取得して raw/ に保存する。
- 取得元: https://danbooru.donmai.us/wiki_pages.json?search[title]=...
- レート配慮: 1リクエストごとに 0.55 秒空ける。失敗は記録して続行。
- インデックス(tag_groups)にあるリンク＋各ページから見つかる tag group リンクを
  閉じるまで辿る（上限 500 ページ）。
"""
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

BASE = Path(__file__).resolve().parent
RAW = BASE / "raw"
RAW.mkdir(parents=True, exist_ok=True)
UA = {"User-Agent": "prompt-workbench-research/1.0 (personal use)"}


def normalize(link: str) -> str:
    return link.strip().lower().replace(" ", "_")


def fetch_page(title: str):
    url = "https://danbooru.donmai.us/wiki_pages.json?" + urllib.parse.urlencode({"search[title]": title})
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode("utf-8"))
    return data[0] if data else None


def group_links(body: str):
    out = []
    for m in re.finditer(r"\[\[([^\]|]+)(?:\|[^\]]*)?\]\]", body):
        link = m.group(1)
        low = link.lower()
        if low.startswith("tag group:") or low.startswith("list of"):
            out.append(normalize(link))
    return out


def main():
    index = json.loads((RAW / "tag_groups.json").read_text(encoding="utf-8"))
    queue = []
    seen = set()
    for title in group_links(index["body"]):
        if title not in seen:
            seen.add(title)
            queue.append(title)

    errors = []
    fetched = 0
    while queue and fetched < 500:
        title = queue.pop(0)
        dest = RAW / (title.replace(":", "_").replace("/", "_") + ".json")
        if dest.exists():
            page = json.loads(dest.read_text(encoding="utf-8"))
        else:
            try:
                page = fetch_page(title)
            except Exception as e:  # noqa: BLE001
                errors.append({"title": title, "error": str(e)})
                continue
            time.sleep(0.55)
            if page is None:
                errors.append({"title": title, "error": "not found"})
                continue
            dest.write_text(json.dumps(page, ensure_ascii=False), encoding="utf-8")
        fetched += 1
        for nxt in group_links(page["body"]):
            if nxt not in seen:
                seen.add(nxt)
                queue.append(nxt)
        if fetched % 25 == 0:
            print(f"fetched {fetched}, queue {len(queue)}", flush=True)

    (BASE / "fetch-errors.json").write_text(json.dumps(errors, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"DONE fetched={fetched} total_seen={len(seen)} errors={len(errors)}")


if __name__ == "__main__":
    main()
