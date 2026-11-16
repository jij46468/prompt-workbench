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
    SNIPPETS: 'prompt_workbench_snippets'
  };

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
  const snippetSubscribers = new Set();

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
  loadSnippets();

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
    }
  };
})();
