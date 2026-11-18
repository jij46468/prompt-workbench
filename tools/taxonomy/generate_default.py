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
    # T17: ポケモン関係と Warframe は作品名へ合流（ユーザー指示）
    'list_of_pokemon_objects': 'pokemon',
    'list_of_pokemon_media': 'pokemon',
    'list_of_pokemon_places': 'pokemon',
    'list_of_pokemon_moves': 'pokemon',
    'list_of_pokemon_abilities': 'pokemon',
    'list_of_pokemon_anime_characters': 'pokemon',
    'list_of_warframes': 'warframe',
}

# T17: 他の大分類へのテーマ別中分類フォルダ（2026-11-18 ユーザーが提案を採用）
# (フォルダID, 大分類, フォルダ名, [グループ名...])
THEMED = [
    ('theme:body_hair', 'Body', '髪', ['hair styles', 'hair', 'hair color']),
    ('theme:body_face', 'Body', '顔', ['eyes tags', 'face tags', 'ears tags']),
    ('theme:body_body', 'Body', '体', ['body parts', 'breasts tags', 'shoulders', 'wings', 'skin color']),
    ('theme:body_posture', 'Body', '姿勢・動き', ['posture', 'gestures', 'hands']),
    ('theme:body_lower', 'Body', '足・下半身', ['feet', 'ass', 'pussy']),
    ('theme:attire_clothes', 'Attire and body accessories', '服', ['attire', 'sleeves', 'legwear', 'fashion style']),
    ('theme:attire_accessories', 'Attire and body accessories', '装身具', ['headwear', 'neck and neckwear', 'accessories', 'handwear', 'makeup']),
    ('theme:attire_skin', 'Attire and body accessories', '肌見せ・性的', ['nudity', 'sexual attire', 'covering']),
    ('theme:comp_layout', 'Image composition and style', '構図・画面', ['image composition', 'focus tags', 'character count', 'backgrounds', 'lighting']),
    ('theme:comp_style', 'Image composition and style', '画風・パロディ', ['style parodies', 'fine art parody', 'artistic license', 'visual aesthetic']),
    ('theme:comp_text', 'Image composition and style', '文字・記号・色', ['text', 'symbols', 'patterns', 'colors']),
    ('theme:comp_misc', 'Image composition and style', 'その他', ['prints', 'year tags', 'censorship', 'japanese dialects']),
    ('theme:obj_weapons', 'Objects', '武器・防具', ['weapons', 'armor']),
    ('theme:obj_vehicles', 'Objects', '乗り物', ['ground vehicles', 'airplanes', 'ships', 'helicopters']),
    ('theme:obj_holding', 'Objects', '持ち方・小物', ['holding tags', 'eyewear', 'cards', 'playing card faces', 'doors and gates']),
    ('theme:obj_audio', 'Objects', '音', ['audio tags', 'microphones']),
    ('theme:obj_sex', 'Objects', '性的小物', ['sex objects']),
    ('theme:more_music', 'More', '音楽・歌', ['vocaloid songs', 'vocaloid derivatives', 'tagged songs', 'vocal synth songs', 'vocal synth derivatives', 'vocal synthesizers']),
    ('theme:more_words', 'More', 'ことば・動き', ['verbs and gerunds', 'phrases', 'dances', 'special moves']),
    ('theme:more_relations', 'More', '関係・ジェンダー', ['family relationships', 'groups', 'gender nonconformity', 'transgender']),
    ('theme:more_nature', 'More', '自然', ['fire', 'water']),
    ('theme:more_misc', 'More', 'その他', ['technology', 'disambiguation pages', 'magazine publications', 'subjective', 'theme']),
    ('theme:more_food', 'More', '食べ物', ['food tags']),
    ('theme:more_uniforms', 'More', '制服', ['uniforms']),
    ('theme:meta_touhou', 'meta-wikis', '東方', ['touhou fanwork tags', 'touhou lostword costumes and variations']),
    ('theme:meta_monsters', 'meta-wikis', '作品別モンスター・生物', ['monster girl encyclopedia monster girls', 'monster hunter monsters', 'youkai watch youkai', 'shin megami tensei demons']),
    ('theme:meta_shared', 'meta-wikis', '会社共有', ['shared cygames characters', 'shared mihoyo characters']),
    ('theme:meta_misc', 'meta-wikis', 'その他', ['music-related series', 'real life animals', 'tamagotchi']),
    ('theme:real_places', 'Real world', '場所', ['locations', 'real world locations']),
    ('theme:real_people', 'Real world', '人・組織', ['people', 'companies and brand names', 'jobs']),
    ('theme:real_culture', 'Real world', '文化・歴史', ['holidays and celebrations', 'history']),
]
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

    # T17: テーマ別フォルダ（大分類は変えず、フォルダ所属だけを付ける）
    by_name = {}
    for g in groups:
        assert g['name'] not in by_name, f"duplicate group name: {g['name']}"
        by_name[g['name']] = g
    themed_folders = []
    folder_order = {CAT_WORKS: [f['id'] for f in ordered]}
    for fid, cat, fname, gnames in THEMED:
        themed_folders.append({'id': fid, 'cat': cat, 'name': fname})
        folder_order.setdefault(cat, []).append(fid)
        for gn in gnames:
            g = by_name[gn]
            assert g['id'] not in group_folder, f"double assignment: {g['id']}"
            group_folder[g['id']] = fid

    out = {
        'version': 1,
        'note': 'T16/T17: 既定の分類上書き。大分類「作品名」に作品別グループをタイトル別フォルダへ、ジャンル別タイトル集をジャンル別フォルダへ集める。他の大分類にはテーマ別フォルダを付ける。生成は tools/taxonomy/generate_default.py。',
        'folders': [{'id': f['id'], 'cat': f['cat'], 'name': f['name']} for f in ordered] + themed_folders,
        'folderOrder': folder_order,
        'groupCat': group_cat,
        'groupFolder': group_folder,
    }
    path = REPO / 'data/taxonomy-default.json'
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')

    print(f"works folders: {len(ordered)} (titles {len(title_folders)} + genres {len(genre_folders)})")
    print(f"themed folders: {len(themed_folders)}")
    print(f"groups moved to works: {len(group_cat)}")
    print(f"groups with folder assignment: {len(group_folder)}")
    print('top folders:', [(f['name'], f['total']) for f in ordered[:6]])
    print('genre folders:', [(f['name'], f['total']) for f in genre_folders])
    multi = {}
    for gid, fid in group_folder.items():
        multi.setdefault(fid, []).append(gid)
    all_names = {f['id']: f['name'] for f in out['folders']}
    print('folders with 2+ groups (works only):',
          {all_names[k]: len(v) for k, v in multi.items() if len(v) > 1 and k in folders})


if __name__ == '__main__':
    main()
