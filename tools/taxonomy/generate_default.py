#!/usr/bin/env python3
"""T16: 既定 taxonomy（大分類「作品名」）の割当表を生成する。

Danbooru Wiki 由来の分類はランダム生成向けではないため、作品別の
グループを大分類「作品名」へ集め、タイトル別の中分類フォルダに入れる
割当を data/taxonomy-default.json として書き出す（アプリ側の既定値）。
ジャンル別タイトル集も「作品名」のジャンル別フォルダへ入れる
（2026-11-18 ユーザー決定）。

振り分け規則:
- 名前が ' characters' / ' servants' で終わるグループは作品別とみなす
  （タイトル = その接尾辞を除いた名前）
- 個別指定の作品別グループは SPECIAL で対応付ける
- テーマ系・会社共有系は EXCLUDE（元の分類に残す）
- ジャンル別タイトル集は GENRE（フォルダ名 = グループ名）
"""
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent
REPO = BASE.parents[1]
CAT_WORKS = '作品名'

SPECIAL = {
    'list_of_pokemon': 'pokemon',
    'list_of_digimon': 'digimon',
    'list_of_genshin_impact_tags': 'genshin impact',
    'list_of_hololive_songs': 'hololive',
    'list_of_gundam_mechas': 'gundam',
    'list_of_arknights_races': 'arknights',
    'list_of_umamusume_costumes': 'umamusume',
}
EXCLUDE = {
    'list_of_genderswapped_characters',   # テーマ（性転換）
    'list_of_official_mascots',           # テーマ（公式マスコット）
    'list_of_real_life_racehorses',       # 実在の競走馬
    'list_of_minecraft_youtubers',        # 実在の配信者
    'list_of_shared_cygames_characters',  # 会社共有（複数作品）
    'list_of_shared_mihoyo_characters',   # 会社共有（複数作品）
}
GENRE = {
    'tag_group:fighting_games',
    'tag_group:platform_games',
    'tag_group:role-playing_games',
    'tag_group:shooter_games',
    'tag_group:visual_novel_games',
    'list_of_gacha_games',
}


def slug(title: str) -> str:
    out = []
    for ch in title.lower():
        out.append(ch if ch.isalnum() else '_')
    return 'work:' + ''.join(out).strip('_')


def title_of(g):
    if g['id'] in SPECIAL:
        return SPECIAL[g['id']]
    name = g['name']
    for suf in (' characters', ' servants'):
        if name.endswith(suf):
            return name[: -len(suf)]
    return None


def main():
    data = json.loads((REPO / 'data/tag-groups.json').read_text(encoding='utf-8'))
    groups = data['groups']

    folders = {}       # folderId -> {'id','cat','name','total'}
    group_cat = {}
    group_folder = {}

    for g in groups:
        if g['id'] in EXCLUDE:
            continue
        if g['id'] in GENRE:
            fid = 'genre:' + g['id'].replace(':', '_')
            folders.setdefault(fid, {'id': fid, 'cat': CAT_WORKS, 'name': g['name'], 'total': 0, 'genre': True})
            folders[fid]['total'] += g['tagCount']
            group_cat[g['id']] = CAT_WORKS
            group_folder[g['id']] = fid
            continue
        title = title_of(g)
        if title is None:
            continue
        fid = slug(title)
        folders.setdefault(fid, {'id': fid, 'cat': CAT_WORKS, 'name': title, 'total': 0, 'genre': False})
        folders[fid]['total'] += g['tagCount']
        group_cat[g['id']] = CAT_WORKS
        group_folder[g['id']] = fid

    title_folders = sorted((f for f in folders.values() if not f['genre']),
                           key=lambda f: (-f['total'], f['name']))
    genre_folders = sorted((f for f in folders.values() if f['genre']),
                           key=lambda f: (-f['total'], f['name']))
    ordered = title_folders + genre_folders

    out = {
        'version': 1,
        'note': 'T16: 既定の分類上書き。大分類「作品名」に作品別グループをタイトル別フォルダへ、ジャンル別タイトル集をジャンル別フォルダへ集める。生成は tools/taxonomy/generate_default.py。',
        'folders': [{'id': f['id'], 'cat': f['cat'], 'name': f['name']} for f in ordered],
        'folderOrder': {CAT_WORKS: [f['id'] for f in ordered]},
        'groupCat': group_cat,
        'groupFolder': group_folder,
    }
    path = REPO / 'data/taxonomy-default.json'
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')

    print(f"folders: {len(ordered)} (titles {len(title_folders)} + genres {len(genre_folders)})")
    print(f"groups moved: {len(group_cat)}")
    print('top folders:', [(f['name'], f['total']) for f in ordered[:6]])
    print('genre folders:', [(f['name'], f['total']) for f in genre_folders])
    multi = {}
    for gid, fid in group_folder.items():
        multi.setdefault(fid, []).append(gid)
    print('folders with 2+ groups:', {folders[k]['name']: len(v) for k, v in multi.items() if len(v) > 1})


if __name__ == '__main__':
    main()
