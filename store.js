/**
 * プロンプト作業台 (Prompt Workbench)
 * データストア層 (スニペット)
 *
 * - localStorage 永続化
 * - 初期状態: 空＋汎用サンプルのみ（Danbooru準拠の英単語タグ）
 * - 外部通信なし、純粋なブラウザストレージのみで動作
 * - T8: ワイルドカードは廃止（ランダムは辞書全件＋フィルター方式へ移行）
 */

(function () {
  'use strict';

  const STORAGE_KEYS = {
    SNIPPETS: 'prompt_workbench_snippets',
    SLOTS: 'prompt_workbench_slots',
    TAXONOMY: 'prompt_workbench_taxonomy'
  };

  /**
   * スロット方式 (T10) の初期プリセット
   * グループIDは data/tag-groups.json の id を指す（実在確認済み）。
   */
  const DEFAULT_SLOTS = [
    { id: 'slot_1', groupId: 'tag_group:hair_styles', section: '', count: 1, percent: 100, enabled: true, collapsed: false },
    { id: 'slot_2', groupId: 'tag_group:eyes_tags', section: '', count: 1, percent: 100, enabled: true, collapsed: false },
    { id: 'slot_3', groupId: 'tag_group:face_tags', section: '', count: 1, percent: 100, enabled: true, collapsed: false },
    { id: 'slot_4', groupId: 'tag_group:attire', section: '', count: 1, percent: 100, enabled: true, collapsed: false },
    { id: 'slot_5', groupId: 'tag_group:backgrounds', section: '', count: 1, percent: 100, enabled: true, collapsed: false },
    { id: 'slot_6', groupId: 'list_of_poses', section: '', count: 1, percent: 100, enabled: true, collapsed: false }
  ];

  /**
   * 汎用サンプルスニペット
   */
  const DEFAULT_SNIPPETS = [
    {
      id: 'snip_quality',
      name: 'quality',
      content: 'masterpiece, best quality, highres'
    },
    {
      id: 'snip_basic',
      name: 'basic',
      content: '1girl, solo, looking_at_viewer'
    }
  ];

  let inMemorySnippets = null;
  let inMemorySlots = null;
  let inMemoryTaxonomy = null;
  const snippetSubscribers = new Set();
  const slotSubscribers = new Set();
  const taxonomySubscribers = new Set();

  /**
   * localStorage からスニペットを読み込み
   * @returns {Array}
   */
  function loadSnippets() {
    try {
      if (typeof localStorage !== 'undefined') {
        const json = localStorage.getItem(STORAGE_KEYS.SNIPPETS);
        if (json) {
          const parsed = JSON.parse(json);
          if (Array.isArray(parsed)) {
            inMemorySnippets = parsed;
            return inMemorySnippets;
          }
        }
      }
    } catch (e) {
      console.warn('localStorage read error for snippets:', e);
    }

    inMemorySnippets = JSON.parse(JSON.stringify(DEFAULT_SNIPPETS));
    saveSnippets(inMemorySnippets);
    return inMemorySnippets;
  }

  /**
   * スニペットを localStorage に保存
   * @param {Array} snippets
   */
  function saveSnippets(snippets) {
    inMemorySnippets = Array.isArray(snippets) ? snippets : [];
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEYS.SNIPPETS, JSON.stringify(inMemorySnippets));
      }
    } catch (e) {
      console.warn('localStorage write error for snippets:', e);
    }
    notifySnippetSubscribers();
  }

  function notifySnippetSubscribers() {
    for (const sub of snippetSubscribers) {
      try {
        sub(inMemorySnippets);
      } catch (err) {
        console.error('Snippet subscriber error:', err);
      }
    }
  }

  /**
   * localStorage からスロット構成を読み込み
   * @returns {Array}
   */
  function loadSlots() {
    try {
      if (typeof localStorage !== 'undefined') {
        const json = localStorage.getItem(STORAGE_KEYS.SLOTS);
        if (json) {
          const parsed = JSON.parse(json);
          if (Array.isArray(parsed)) {
            inMemorySlots = parsed;
            return inMemorySlots;
          }
        }
      }
    } catch (e) {
      console.warn('localStorage read error for slots:', e);
    }

    inMemorySlots = JSON.parse(JSON.stringify(DEFAULT_SLOTS));
    saveSlots(inMemorySlots);
    return inMemorySlots;
  }

  /**
   * スロット構成を localStorage に保存
   * @param {Array} slots
   */
  function saveSlots(slots) {
    inMemorySlots = Array.isArray(slots) ? slots : [];
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEYS.SLOTS, JSON.stringify(inMemorySlots));
      }
    } catch (e) {
      console.warn('localStorage write error for slots:', e);
    }
    notifySlotSubscribers();
  }

  function notifySlotSubscribers() {
    for (const sub of slotSubscribers) {
      try {
        sub(inMemorySlots);
      } catch (err) {
        console.error('Slot subscriber error:', err);
      }
    }
  }

  /**
   * 分類の上書き (T15) を読み込み
   * 形式: { catOrder?: string[], groupCat?: {groupId: catName},
   *         folders?: [{id, cat, name}], folderOrder?: {catName: folderId[]},
   *         groupFolder?: {groupId: folderId}, order?: {containerKey: groupId[]} }
   * containerKey は 'cat:<大分類名>' または 'folder:<folderId>'。
   * 未保存なら null（＝上書きなし、データ既定の分類を使う）。
   */
  function loadTaxonomy() {
    try {
      if (typeof localStorage !== 'undefined') {
        const json = localStorage.getItem(STORAGE_KEYS.TAXONOMY);
        if (json) {
          const parsed = JSON.parse(json);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            inMemoryTaxonomy = parsed;
            return inMemoryTaxonomy;
          }
        }
      }
    } catch (e) {
      console.warn('localStorage read error for taxonomy:', e);
    }
    inMemoryTaxonomy = null;
    return inMemoryTaxonomy;
  }

  function saveTaxonomy(taxonomy) {
    inMemoryTaxonomy = (taxonomy && typeof taxonomy === 'object' && !Array.isArray(taxonomy))
      ? taxonomy : null;
    try {
      if (typeof localStorage !== 'undefined') {
        if (inMemoryTaxonomy) {
          localStorage.setItem(STORAGE_KEYS.TAXONOMY, JSON.stringify(inMemoryTaxonomy));
        } else {
          localStorage.removeItem(STORAGE_KEYS.TAXONOMY);
        }
      }
    } catch (e) {
      console.warn('localStorage write error for taxonomy:', e);
    }
    notifyTaxonomySubscribers();
  }

  function notifyTaxonomySubscribers() {
    for (const sub of taxonomySubscribers) {
      try {
        sub(inMemoryTaxonomy);
      } catch (err) {
        console.error('Taxonomy subscriber error:', err);
      }
    }
  }

  // 初期化実行
  loadSnippets();
  loadSlots();
  loadTaxonomy();

  // PromptWorkbench 名前空間にエクスポート
  window.PromptWorkbench = window.PromptWorkbench || {};
  window.PromptWorkbench.store = {
    getSnippets: () => {
      if (!inMemorySnippets) loadSnippets();
      return JSON.parse(JSON.stringify(inMemorySnippets));
    },
    saveSnippets: (snippets) => {
      saveSnippets(snippets);
    },
    subscribeSnippets: (fn) => {
      snippetSubscribers.add(fn);
      return () => snippetSubscribers.delete(fn);
    },
    getSlots: () => {
      if (!inMemorySlots) loadSlots();
      return JSON.parse(JSON.stringify(inMemorySlots));
    },
    saveSlots: (slots) => {
      saveSlots(slots);
    },
    resetSlots: () => {
      saveSlots(JSON.parse(JSON.stringify(DEFAULT_SLOTS)));
    },
    subscribeSlots: (fn) => {
      slotSubscribers.add(fn);
      return () => slotSubscribers.delete(fn);
    },
    getTaxonomy: () => {
      if (inMemoryTaxonomy === null) loadTaxonomy();
      return inMemoryTaxonomy ? JSON.parse(JSON.stringify(inMemoryTaxonomy)) : null;
    },
    saveTaxonomy: (taxonomy) => {
      saveTaxonomy(taxonomy);
    },
    resetTaxonomy: () => {
      saveTaxonomy(null);
    },
    subscribeTaxonomy: (fn) => {
      taxonomySubscribers.add(fn);
      return () => taxonomySubscribers.delete(fn);
    }
  };
})();
