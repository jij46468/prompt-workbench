#!/usr/bin/env python3
"""raw/ の Wiki ページ群を解析し、data/tag-groups.json と TAG_GROUPS.md を作る。

解析ルール (DText):
- 目次 [expand=Table of Contents]...[/expand] は除外。
- h4./h5./h6. 見出しをセクションとして追跡。
- 箇条書き行（* で始まる行）と表の行（| を含む行）から [[tag]] リンクと
  素のタグ名トークンを抽出する。
- 最後に辞書 (data/danbooru.csv) と突き合わせ、辞書に実在するタグだけを残す
  （散文中の単語などのノイズを落とす）。
"""
import csv
import json
import re
from collections import Counter, OrderedDict
from pathlib import Path

BASE = Path(__file__).resolve().parent
REPO = BASE.parents[1]
RAW = BASE / "raw"
FETCHED_AT = "2026-11-17"
SOURCE = "https://danbooru.donmai.us/wiki_pages/tag_groups"

GROUP_PREFIXES = ("tag group:", "list of", "tag_group:", "list_of")


def norm(text: str) -> str:
    return text.strip().lower().replace(" ", "_")


def display_name(title: str) -> str:
    name = re.sub(r"^(tag_group:|list_of_?)", "", title)
    return name.replace("_", " ").strip()


def load_dictionary():
    tags = {}
    with open(REPO / "data/danbooru.csv", encoding="utf-8") as f:
        for row in csv.reader(f):
            if len(row) >= 3:
                tags[row[0]] = {"category": int(row[1]), "count": int(row[2])}
    return tags


def strip_toc(body: str) -> str:
    return re.sub(r"\[expand=Table of Contents\].*?\[/expand\]", "", body, flags=re.S)


HEADER_RE = re.compile(r"^h[456](?:#[\w-]+)?\.\s*(.+?)\s*$")
LINK_RE = re.compile(r"\[\[([^\]|]+)(?:\|[^\]]*)?\]\]")
TOKEN_RE = re.compile(r"^[a-z0-9][a-z0-9_()\-./':]*$")


def extract_from_line(line: str):
    """1行からタグ候補を抽出（正規化済み文字列のリスト）。"""
    found = []
    for m in LINK_RE.finditer(line):
        target = m.group(1).strip()
        low = target.lower()
        if low.startswith(GROUP_PREFIXES) or "://" in target or low.startswith("http"):
            continue
        found.append(norm(target))
    # リンクを除いた残りから素のトークンを拾う（箇条書き行のみ想定）
    rest = LINK_RE.sub(" ", line).lstrip("* ").strip()
    if rest:
        first = rest.split()[0].strip(",;")
        if TOKEN_RE.match(first) and "_" in first or (TOKEN_RE.match(first) and first.islower()):
            if first not in ("see", "note", "the", "a", "an"):
                found.append(first)
    return found


def parse_page(body: str):
    """ページ本文 -> OrderedDict[セクション名, set(タグ)] と 子グループリンク。"""
    body = strip_toc(body)
    sections = OrderedDict()
    current = "(全般)"
    sections[current] = set()
    child_groups = []
    for raw_line in body.splitlines():
        line = raw_line.strip()
        hm = HEADER_RE.match(line)
        if hm:
            title = LINK_RE.sub(lambda m: m.group(1), hm.group(1)).strip()
            title = re.sub(r"\[\[|\]\]", "", title)
            current = title if title else current
            sections.setdefault(current, set())
            continue
        for m in LINK_RE.finditer(line):
            low = m.group(1).strip().lower()
            if low.startswith(GROUP_PREFIXES):
                child_groups.append(norm(m.group(1)))
        is_bullet = line.startswith("*")
        is_table = line.startswith("|") or line.startswith("||")
        if is_bullet or is_table:
            for tag in extract_from_line(line):
                sections[current].add(tag)
    return sections, child_groups


def parse_index_hierarchy(index_body: str):
    """tag_groups インデックスの大分類 (h5/h6) を各グループへ割り当てる。"""
    body = strip_toc(index_body)
    parents = {}
    h5 = h6 = ""
    for raw_line in body.splitlines():
        line = raw_line.strip()
        m5 = re.match(r"^h5(?:#[\w-]+)?\.\s*(.+?)\s*$", line)
        m6 = re.match(r"^h6(?:#[\w-]+)?\.\s*(.+?)\s*$", line)
        if m5:
            h5, h6 = m5.group(1).strip(), ""
            continue
        if m6:
            h6 = m6.group(1).strip()
            continue
        for m in LINK_RE.finditer(line):
            low = m.group(1).strip().lower()
            if low.startswith(GROUP_PREFIXES):
                parents[norm(m.group(1))] = h6 or h5 or ""
    return parents


def main():
    dictionary = load_dictionary()
    pages = {}
    for path in sorted(RAW.glob("*.json")):
        page = json.loads(path.read_text(encoding="utf-8"))
        pages[page["title"]] = page

    index = pages.pop("tag_groups")
    parents = parse_index_hierarchy(index["body"])

    groups = []
    tag_to_groups = {}
    memberships = 0
    linker = {}
    for title in sorted(pages):
        sections_raw, children = parse_page(pages[title]["body"])
        for child in children:
            linker.setdefault(child, title)
        sections = []
        group_tags = set()
        for sec_name, tagset in sections_raw.items():
            kept = sorted(t for t in tagset if t in dictionary)
            if kept:
                sections.append({"name": sec_name, "tags": kept})
                group_tags.update(kept)
        if not group_tags:
            continue
        parent = parents.get(title) or (display_name(linker[title]) if title in linker else "")
        groups.append({
            "id": title,
            "name": display_name(title),
            "parent": parent,
            "tagCount": len(group_tags),
            "sections": sections,
        })
        memberships += len(group_tags)
        for t in group_tags:
            tag_to_groups.setdefault(t, []).append(title)

    groups.sort(key=lambda g: (g["parent"], g["name"]))
    classified = len(tag_to_groups)
    general_total = sum(1 for v in dictionary.values() if v["category"] == 0)
    general_classified = sum(1 for t in tag_to_groups if dictionary[t]["category"] == 0)

    out = {
        "version": 1,
        "source": SOURCE,
        "fetchedAt": FETCHED_AT,
        "dictionaryTags": len(dictionary),
        "groupCount": len(groups),
        "classifiedTags": classified,
        "memberships": memberships,
        "groups": groups,
    }
    dest = REPO / "data/tag-groups.json"
    dest.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # ---- 概要ドキュメント ----
    by_parent = OrderedDict()
    for g in groups:
        by_parent.setdefault(g["parent"] or "(その他)", []).append(g)
    lines = [
        "# タググループ分類（Danbooru Wiki tag_groups 由来）",
        "",
        f"- 取得元: {SOURCE}（Wiki API 経由、{FETCHED_AT} 取得）",
        f"- グループ数: {len(groups)} / 分類済みタグ: {classified:,} 件"
        f"（辞書 {len(dictionary):,} 件中 {classified / len(dictionary) * 100:.1f}%、所属のべ {memberships:,} 件）",
        f"- 「一般」カテゴリ内の分類率: {general_classified:,} / {general_total:,} 件"
        f"（{general_classified / general_total * 100:.1f}%）",
        "- 1タグが複数グループに所属してよい（Wiki 原典の考え方どおり）。",
        "- データ本体は `data/tag-groups.json`。生成手順は `tools/tag-groups/`（fetch.py → build.py）。",
        "",
        "## 大分類ごとのグループ一覧",
        "",
    ]
    for parent, gs in by_parent.items():
        lines.append(f"### {parent}")
        lines.append("")
        for g in sorted(gs, key=lambda x: -x["tagCount"]):
            lines.append(f"- {g['name']}（{g['tagCount']} 件）")
        lines.append("")
    (REPO / "TAG_GROUPS.md").write_text("\n".join(lines), encoding="utf-8")

    print(f"groups={len(groups)} classified={classified} memberships={memberships}")
    print(f"general coverage: {general_classified}/{general_total}")
    print(f"json bytes: {dest.stat().st_size:,}")
    top = sorted(groups, key=lambda g: -g["tagCount"])[:10]
    for g in top:
        print(f"  {g['tagCount']:>5}  {g['name']}  [{g['parent']}]")
    empty = [t for t in pages if t not in {g['id'] for g in groups}]
    print(f"pages with no dictionary-matched tags: {len(empty)}")


if __name__ == "__main__":
    main()
