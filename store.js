/**
 * プロンプト作業台 (Prompt Workbench)
 * データストア層 (ワイルドカード & スニペット)
 * 
 * - localStorage 永続化
 * - 初期状態: 空＋汎用サンプルのみ（Danbooru準拠の英単語タグ）
 * - 外部通信なし、純粋なブラウザストレージのみで動作
 */

(function () {
  'use strict';

  const STORAGE_KEYS = {
    WILDCARDS: 'prompt_workbench_wildcards',
    SNIPPETS: 'prompt_workbench_snippets'
  };

  /**
   * 汎用サンプルワイルドカード
   * ※ SPEC §1 および AGENTS.md 準拠：
   * ユーザーの実データは含めず、Danbooruタグ等の汎用英単語のみで構成
   */
  const DEFAULT_WILDCARDS = {
    '髪型': [
      'short_hair',
      'long_hair',
      'twintails',
      'ponytail',
      'bob_cut',
      'braid'
    ],
    '衣装': [
      'school_uniform',
      'serafuku',
      'dress',
      'hoodie',
      'shirt',
      'sweater'
    ],
    '背景': [
      'simple_background',
      'white_background',
      'outdoors',
      'indoors',
      'classroom',
      'street'
    ],
    '画風': [
      'monochrome',
      'greyscale',
      'watercolor',
      'flat_color',
      'retro_artstyle'
    ],
    '表情': [
      'smile',
      'open_mouth',
      'blush',
      'closed_eyes',
      'wink'
    ],
    'hairstyle': [
      'short_hair',
      'long_hair',
      'twintails',
      'ponytail',
      'bob_cut'
    ],
    'outfit': [
      'school_uniform',
      'serafuku',
      'dress',
      'hoodie',
      'shirt'
    ],
    'background': [
      'simple_background',
      'white_background',
      'outdoors',
      'indoors'
    ],
    'style': [
      'monochrome',
      'greyscale',
      'watercolor',
      'flat_color'
    ]
  };

  /**
   * 汎用サンプるスニペット
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

  let inMemoryWildcards = null;
  let inMemorySnippets = null;
  const wildcardSubscribers = new Set();
  const snippetSubscribers = new Set();

  /**
   * localStorage からワイルドカードを読み込み
   * @returns {Object}
   */
  function loadWildcards() {
    try {
      if (typeof localStorage !== 'undefined') {
        const json = localStorage.getItem(STORAGE_KEYS.WILDCARDS);
        if (json) {
          const parsed = JSON.parse(json);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            inMemoryWildcards = parsed;
            return inMemoryWildcards;
          }
        }
      }
    } catch (e) {
      console.warn('localStorage read error for wildcards:', e);
    }

    // 初回初期化または復旧
    inMemoryWildcards = JSON.parse(JSON.stringify(DEFAULT_WILDCARDS));
    saveWildcards(inMemoryWildcards);
    return inMemoryWildcards;
  }

  /**
   * ワイルドカードを localStorage に保存
   * @param {Object} wildcards
   */
  function saveWildcards(wildcards) {
    inMemoryWildcards = wildcards || {};
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEYS.WILDCARDS, JSON.stringify(inMemoryWildcards));
      }
    } catch (e) {
      console.warn('localStorage write error for wildcards:', e);
    }
    notifyWildcardSubscribers();
  }

  function notifyWildcardSubscribers() {
    for (const sub of wildcardSubscribers) {
      try {
        sub(inMemoryWildcards);
      } catch (err) {
        console.error('Wildcard subscriber error:', err);
      }
    }
  }

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

  // 初期化実行
  loadWildcards();
  loadSnippets();

  // PromptWorkbench 名前空間にエクスポート
  window.PromptWorkbench = window.PromptWorkbench || {};
  window.PromptWorkbench.store = {
    getWildcards: () => {
      if (!inMemoryWildcards) loadWildcards();
      return JSON.parse(JSON.stringify(inMemoryWildcards));
    },
    getWildcard: (name) => {
      if (!inMemoryWildcards) loadWildcards();
      const items = inMemoryWildcards[name];
      return Array.isArray(items) ? [...items] : undefined;
    },
    setWildcard: (name, items) => {
      if (!inMemoryWildcards) loadWildcards();
      inMemoryWildcards[name] = Array.isArray(items) ? items : [];
      saveWildcards(inMemoryWildcards);
    },
    deleteWildcard: (name) => {
      if (!inMemoryWildcards) loadWildcards();
      if (name in inMemoryWildcards) {
        delete inMemoryWildcards[name];
        saveWildcards(inMemoryWildcards);
        return true;
      }
      return false;
    },
    getWildcardNames: () => {
      if (!inMemoryWildcards) loadWildcards();
      return Object.keys(inMemoryWildcards);
    },
    resetWildcards: () => {
      saveWildcards(JSON.parse(JSON.stringify(DEFAULT_WILDCARDS)));
    },
    subscribeWildcards: (fn) => {
      wildcardSubscribers.add(fn);
      return () => wildcardSubscribers.delete(fn);
    },
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
    }
  };
})();
