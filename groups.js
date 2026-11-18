/**
 * プロンプト作業台 (Prompt Workbench)
 * T9: タググループ分類 (Danbooru Wiki tag_groups 由来)
 *
 * - data/tag-groups.json (294グループ / 分類済み26,149タグ) を同一オリジンから取得
 * - グループ -> タグ集合、タグ -> グループ の索引を構築する
 * - 読み込み失敗時もアプリ全体は動作継続（グループ絞り込みだけが無効になる）
 */

(function () {
  'use strict';

  const JSON_PATH = 'data/tag-groups.json';

  const state = {
    status: 'idle', // 'idle' | 'loading' | 'ready' | 'error'
    groups: [],          // [{ id, name, parent, tagCount, sections }]
    groupTagSets: new Map(), // id -> Set<tagName>
    tagGroups: new Map(),    // tagName -> [groupId]
    classifiedTags: 0,
    error: null
  };

  async function loadGroups() {
    if (state.status === 'loading' || state.status === 'ready') return;
    state.status = 'loading';
    try {
      const response = await fetch(JSON_PATH);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();

      state.groups = Array.isArray(data.groups) ? data.groups : [];
      state.classifiedTags = data.classifiedTags || 0;
      for (const g of state.groups) {
        const set = new Set();
        for (const sec of g.sections || []) {
          for (const t of sec.tags || []) set.add(t);
        }
        state.groupTagSets.set(g.id, set);
        for (const t of set) {
          let arr = state.tagGroups.get(t);
          if (!arr) { arr = []; state.tagGroups.set(t, arr); }
          arr.push(g.id);
        }
      }
      state.status = 'ready';
      updateManageStat();
    } catch (err) {
      console.warn('Tag groups loading error:', err);
      state.status = 'error';
      state.error = err;
      updateManageStat();
    }
  }

  function updateManageStat() {
    const el = document.getElementById('groupStatValue');
    if (!el) return;
    if (state.status === 'ready') {
      el.textContent = `${state.groups.length} グループ / ${state.classifiedTags.toLocaleString()} タグ分類済み`;
    } else if (state.status === 'error') {
      el.textContent = '読み込み失敗（絞り込みは無効）';
    } else {
      el.textContent = '読み込み中...';
    }
  }

  /* ----------------------------------------------------------------------
     T15: 分類ツリー（大分類 → 中分類フォルダ → グループ）とセクション
     - 既定の大分類は T14 の規則（parent、無ければ内容で振り分け）
     - 端末内の上書き（store の taxonomy）で並び順・所属・フォルダを差し替える
     - セクションは元データ（Wiki ページ内の見出し分け）をそのまま使う
     ---------------------------------------------------------------------- */
  const CAT_CHARACTER_LISTS = 'Character lists by work';
  const CAT_UNCATEGORIZED = 'Uncategorized';

  function defaultCategoryOf(g) {
    if (g.parent) return g.parent;
    if (g.id.includes('characters') || g.id.endsWith('servants')) return CAT_CHARACTER_LISTS;
    return CAT_UNCATEGORIZED;
  }

  // 既定の並び: 分類はグループ数の多い順（同数は名前順）、分類内はタグ数の多い順
  function defaultTree(groups) {
    const map = new Map();
    for (const g of groups) {
      const key = defaultCategoryOf(g);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(g);
    }
    const cats = [...map.entries()].map(([name, gs]) => ({
      name,
      folders: [],
      direct: gs.slice().sort((a, b) => b.tagCount - a.tagCount)
    }));
    cats.sort((a, b) => b.direct.length - a.direct.length || a.name.localeCompare(b.name));
    return cats;
  }

  // 保存済みの並び（ID列）を先に置き、未記載分を既定順で後ろに足す
  function applyOrder(items, savedIds, idOf) {
    if (!Array.isArray(savedIds) || !savedIds.length) return items.slice();
    const byId = new Map(items.map(it => [idOf(it), it]));
    const out = [];
    const used = new Set();
    for (const id of savedIds) {
      if (byId.has(id) && !used.has(id)) { out.push(byId.get(id)); used.add(id); }
    }
    for (const it of items) {
      if (!used.has(idOf(it))) out.push(it);
    }
    return out;
  }

  /**
   * 上書きを適用した分類ツリーを返す（純粋関数、検証用に公開）
   * @returns [{ name, folders: [{id, name, groups: [g]}], direct: [g] }]
   */
  function buildTaxonomyTree(groups, tax) {
    const t = tax && typeof tax === 'object' ? tax : {};
    const groupCat = t.groupCat && typeof t.groupCat === 'object' ? t.groupCat : {};
    const groupFolder = t.groupFolder && typeof t.groupFolder === 'object' ? t.groupFolder : {};
    const order = t.order && typeof t.order === 'object' ? t.order : {};
    const folderOrder = t.folderOrder && typeof t.folderOrder === 'object' ? t.folderOrder : {};
    const folders = Array.isArray(t.folders) ? t.folders.filter(f => f && f.id && f.cat) : [];
    const folderById = new Map(folders.map(f => [f.id, f]));

    const tree = defaultTree(groups);
    const catMap = new Map(tree.map(c => [c.name, { name: c.name, folders: [], direct: [] }]));

    // フォルダを用意（所属する大分類が無ければ作る）
    for (const f of folders) {
      if (!catMap.has(f.cat)) catMap.set(f.cat, { name: f.cat, folders: [], direct: [] });
      catMap.get(f.cat).folders.push({ id: f.id, name: f.name || f.id, groups: [] });
    }
    const folderNode = new Map();
    for (const c of catMap.values()) for (const fn of c.folders) folderNode.set(fn.id, fn);

    // グループを振り分け（既定分類 → groupCat で移動 → groupFolder でフォルダへ）
    const defaultCat = new Map();
    for (const c of tree) for (const g of c.direct) defaultCat.set(g.id, c.name);
    for (const g of groups) {
      const catName = groupCat[g.id] || defaultCat.get(g.id);
      if (!catMap.has(catName)) catMap.set(catName, { name: catName, folders: [], direct: [] });
      const cat = catMap.get(catName);
      const fid = groupFolder[g.id];
      const fnode = fid ? folderNode.get(fid) : null;
      // フォルダが別大分類にある場合はフォルダ所属を優先しない（大分類移動を優先）
      if (fnode && folderById.get(fid).cat === catName) fnode.groups.push(g);
      else cat.direct.push(g);
    }

    // 並び順の適用
    for (const c of catMap.values()) {
      c.direct = applyOrder(
        c.direct.slice().sort((a, b) => b.tagCount - a.tagCount),
        order[`cat:${c.name}`], g => g.id);
      for (const fn of c.folders) {
        fn.groups = applyOrder(
          fn.groups.slice().sort((a, b) => b.tagCount - a.tagCount),
          order[`folder:${fn.id}`], g => g.id);
      }
      c.folders = applyOrder(c.folders, folderOrder[c.name], f => f.id);
    }
    let cats = [...catMap.values()];
    cats = applyOrder(cats, t.catOrder, c => c.name);
    return cats;
  }

  function currentTaxonomy() {
    const store = window.PromptWorkbench && window.PromptWorkbench.store;
    return store && typeof store.getTaxonomy === 'function' ? store.getTaxonomy() : null;
  }

  function getGroupById(groupId) {
    return state.groups.find(g => g.id === groupId) || null;
  }

  window.PromptWorkbenchGroups = {
    load: loadGroups,
    getStatus: () => ({
      status: state.status,
      groupCount: state.groups.length,
      classifiedTags: state.classifiedTags,
      error: state.error ? state.error.message : null
    }),
    getGroups: () => state.groups.slice(),
    getTagSet: (groupId) => state.groupTagSets.get(groupId) || null,
    getGroupsForTag: (tagName) => state.tagGroups.get(tagName) || [],
    // T15
    defaultCategoryOf,
    buildTaxonomyTree,
    getTaxonomyTree: () => buildTaxonomyTree(state.groups, currentTaxonomy()),
    getGroupCategory: (groupId) => {
      const g = getGroupById(groupId);
      return g ? (buildTaxonomyTree(state.groups, currentTaxonomy())
        .find(c => c.direct.some(x => x.id === groupId) ||
          c.folders.some(f => f.groups.some(x => x.id === groupId))) || {}).name || defaultCategoryOf(g) : null;
    },
    getSections: (groupId) => {
      const g = getGroupById(groupId);
      if (!g) return [];
      const seen = new Map();
      for (const sec of g.sections || []) {
        const name = sec.name || '';
        if (!seen.has(name)) seen.set(name, new Set());
        for (const t of sec.tags || []) seen.get(name).add(t);
      }
      return [...seen.entries()].map(([name, set]) => ({ name, tagCount: set.size }));
    },
    getSectionTagSet: (groupId, sectionName) => {
      const g = getGroupById(groupId);
      if (!g) return null;
      const set = new Set();
      for (const sec of g.sections || []) {
        if ((sec.name || '') !== sectionName) continue;
        for (const t of sec.tags || []) set.add(t);
      }
      return set.size ? set : null;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { loadGroups(); updateManageStat(); });
  } else {
    loadGroups();
    updateManageStat();
  }
})();
