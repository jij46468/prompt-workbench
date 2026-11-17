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
    getGroupsForTag: (tagName) => state.tagGroups.get(tagName) || []
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { loadGroups(); updateManageStat(); });
  } else {
    loadGroups();
    updateManageStat();
  }
})();
