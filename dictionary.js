/**
 * プロンプト作業台 (Prompt Workbench)
 * T3: Danbooru辞書読み込み・索引構築・補完プロバイダー・進捗表示
 * 
 * - data/danbooru.csv (140,782件, 約3.5MB) を同一オリジンから取得
 * - 先頭文字および単語区切り・エイリアスによる高速索引の構築
 * - 使用頻度順（投稿数降順）・カテゴリ色分け・エイリアス検索
 * - 読み込み進捗表示 (編集画面の進捗バー & 管理画面の辞書情報カード)
 * - window.PromptWorkbench.setSuggestionsProvider への接続
 * - 辞書未読込時・読込中・エラー時もフリーテキスト入力（チップ化）を常時維持
 */

(function () {
  'use strict';

  const CSV_PATH = 'data/danbooru.csv';
  const ESTIMATED_TOTAL_BYTES = 3518020; // 3.5MB (Content-Length ヘッダー不在時のフォールバック値)
  const PARSE_BATCH_SIZE = 25000;        // UI スレッドをブロックしないためのバッチ行数

  /**
   * 辞書状態管理オブジェクト
   */
  const state = {
    status: 'idle', // 'idle' | 'loading' | 'indexing' | 'ready' | 'error'
    tags: [],
    index: new Map(), // 先頭文字 (小文字) -> タグオブジェクト配列
    progress: {
      percent: 0,
      phase: '',
      detail: ''
    },
    error: null,
    totalBytes: ESTIMATED_TOTAL_BYTES,
    receivedBytes: 0,
    startTime: 0,
    compactTimer: null
  };

  /* ==========================================================================
     DOM 要素の取得
     ========================================================================== */
  // 編集画面：辞書進捗ステータスバー
  const dictStatusBar = document.getElementById('dictStatusBar');
  const dictStatusDot = document.getElementById('dictStatusDot');
  const dictStatusText = document.getElementById('dictStatusText');
  const dictStatusPercent = document.getElementById('dictStatusPercent');
  const dictProgressTrack = document.getElementById('dictProgressTrack');
  const dictProgressBar = document.getElementById('dictProgressBar');
  const dictRetryBtn = document.getElementById('dictRetryBtn');

  // 管理画面：辞書情報カード
  const dictManageBadge = document.getElementById('dictManageBadge');
  const dictStatTags = document.getElementById('dictStatTags');
  const dictStatKeys = document.getElementById('dictStatKeys');
  const dictStatState = document.getElementById('dictStatState');
  const dictReloadBtn = document.getElementById('dictReloadBtn');
  const dictReloadBtnText = document.getElementById('dictReloadBtnText');

  /**
   * UI スレッドへの実行権譲渡 (描画フレーム維持 & 背景タブ対応)
   * @returns {Promise<void>}
   */
  function yieldToMain() {
    return new Promise(resolve => {
      if (typeof requestAnimationFrame === 'function' && document.visibilityState === 'visible') {
        requestAnimationFrame(resolve);
      } else {
        setTimeout(resolve, 0);
      }
    });
  }

  /**
   * UI 表示の更新
   */
  function updateUI() {
    const { status, progress, tags, index, error } = state;

    // 1. 編集画面ステータスバーの更新
    if (dictStatusBar) {
      // 既存状態クラスの除去
      dictStatusBar.classList.remove('is-loading', 'is-ready', 'is-error');

      if (status === 'loading' || status === 'indexing') {
        dictStatusBar.classList.add('is-loading');
        dictStatusBar.classList.remove('is-compact');
        if (dictStatusText) dictStatusText.textContent = progress.detail || '辞書を読み込み中...';
        if (dictStatusPercent) dictStatusPercent.textContent = `${progress.percent}%`;
        if (dictProgressBar) dictProgressBar.style.width = `${progress.percent}%`;
        if (dictProgressTrack) dictProgressTrack.hidden = false;
        if (dictRetryBtn) dictRetryBtn.hidden = true;
      } else if (status === 'ready') {
        dictStatusBar.classList.add('is-ready');
        if (dictStatusText) dictStatusText.textContent = `Danbooru辞書: ${tags.length.toLocaleString()}件 (準備完了)`;
        if (dictStatusPercent) dictStatusPercent.textContent = '100%';
        if (dictProgressBar) dictProgressBar.style.width = '100%';
        if (dictRetryBtn) dictRetryBtn.hidden = true;

        // 読み込み完了後、数秒後に進捗トラックをすっきり畳む
        if (state.compactTimer) clearTimeout(state.compactTimer);
        state.compactTimer = setTimeout(() => {
          if (state.status === 'ready' && dictStatusBar) {
            dictStatusBar.classList.add('is-compact');
          }
        }, 2200);
      } else if (status === 'error') {
        dictStatusBar.classList.add('is-error');
        dictStatusBar.classList.remove('is-compact');
        if (dictStatusText) {
          dictStatusText.textContent = '辞書の読み込みに失敗しました（フリー入力は利用可能）';
        }
        if (dictStatusPercent) dictStatusPercent.textContent = 'エラー';
        if (dictProgressTrack) dictProgressTrack.hidden = true;
        if (dictRetryBtn) dictRetryBtn.hidden = false;
      }
    }

    // 2. 補完候補ドロップダウンヘッダータイトルの更新
    if (window.PromptWorkbench && typeof window.PromptWorkbench.setSuggestionsHeaderTitle === 'function') {
      if (status === 'ready') {
        window.PromptWorkbench.setSuggestionsHeaderTitle('補完候補 (Danbooru辞書)');
      } else if (status === 'loading' || status === 'indexing') {
        window.PromptWorkbench.setSuggestionsHeaderTitle('補完候補 (辞書読込中...)');
      } else if (status === 'error') {
        window.PromptWorkbench.setSuggestionsHeaderTitle('補完候補 (フリー入力・仮候補)');
      }
    }

    // 3. 管理画面辞書情報カードの更新
    if (dictManageBadge) {
      dictManageBadge.classList.remove('is-loading', 'is-ready', 'is-error');
      if (status === 'loading' || status === 'indexing') {
        dictManageBadge.classList.add('is-loading');
        dictManageBadge.textContent = `読込中 (${progress.percent}%)`;
      } else if (status === 'ready') {
        dictManageBadge.classList.add('is-ready');
        dictManageBadge.textContent = '準備完了';
      } else if (status === 'error') {
        dictManageBadge.classList.add('is-error');
        dictManageBadge.textContent = 'エラー';
      } else {
        dictManageBadge.textContent = '未読込';
      }
    }

    if (dictStatTags) {
      dictStatTags.textContent = tags.length > 0 ? `${tags.length.toLocaleString()} 件` : '0 件';
    }
    if (dictStatKeys) {
      dictStatKeys.textContent = index.size > 0 ? `${index.size.toLocaleString()} 区分` : '0 区分';
    }
    if (dictStatState) {
      if (status === 'loading') {
        dictStatState.textContent = 'ダウンロード中...';
      } else if (status === 'indexing') {
        dictStatState.textContent = '索引構築中...';
      } else if (status === 'ready') {
        dictStatState.textContent = '読み込み完了';
      } else if (status === 'error') {
        dictStatState.textContent = '取得失敗 (再試行可)';
      } else {
        dictStatState.textContent = '未初期化';
      }
    }

    if (dictReloadBtn) {
      dictReloadBtn.disabled = status === 'loading' || status === 'indexing';
    }
  }

  /**
   * 文字列から単語の先頭文字キーを抽出
   * @param {string} str
   * @returns {string[]}
   */
  function extractWordKeys(str) {
    if (!str) return [];
    const keys = [];
    // 記号などで分割してトークン化
    const tokens = str.toLowerCase().split(/[^a-z0-9:]+/);
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok.length > 0) {
        keys.push(tok[0]);
      }
    }
    return keys;
  }

  /**
   * CSV から Danbooru 辞書を読み込み、先頭文字索引を構築
   * @param {Object} options
   * @param {boolean} options.forceReload - キャッシュを無効化して再取得するか
   */
  async function loadDictionary({ forceReload = false } = {}) {
    if (state.status === 'loading' || state.status === 'indexing') {
      return;
    }

    state.status = 'loading';
    state.error = null;
    state.startTime = Date.now();
    state.progress = {
      percent: 0,
      phase: 'download',
      detail: '辞書データを取得中...'
    };
    updateUI();

    try {
      const fetchUrl = forceReload ? `${CSV_PATH}?t=${Date.now()}` : CSV_PATH;
      const response = await fetch(fetchUrl);

      if (!response.ok) {
        throw new Error(`辞書ファイルの取得に失敗しました (HTTP ${response.status})`);
      }

      // Content-Length 取得 (存在しない場合は概算値を使用)
      const contentLengthHeader = response.headers.get('content-length');
      const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : ESTIMATED_TOTAL_BYTES;
      state.totalBytes = totalBytes;

      let text = '';

      // ストリーミング読み取りによる進捗計測
      if (response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();
        const chunks = [];
        let receivedBytes = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          chunks.push(value);
          receivedBytes += value.length;
          state.receivedBytes = receivedBytes;

          const downloadPercent = Math.min(100, Math.round((receivedBytes / totalBytes) * 100));
          // ダウンロードフェーズは全体の 0% 〜 45%
          const overallPercent = Math.round(downloadPercent * 0.45);
          state.progress = {
            percent: overallPercent,
            phase: 'download',
            detail: `辞書をダウンロード中... ${downloadPercent}% (${(receivedBytes / (1024 * 1024)).toFixed(1)} MB)`
          };
          updateUI();
        }

        // チャンク結合と UTF-8 デコード
        const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
        const allBytes = new Uint8Array(totalLen);
        let offset = 0;
        for (const chunk of chunks) {
          allBytes.set(chunk, offset);
          offset += chunk.length;
        }
        text = new TextDecoder('utf-8').decode(allBytes);
      } else {
        // ReadableStream 非対応環境向けフォールバック
        text = await response.text();
      }

      // フェーズ2: CSV 解析 & 先頭文字索引構築 (全体の 45% 〜 100%)
      state.status = 'indexing';
      state.progress = {
        percent: 45,
        phase: 'indexing',
        detail: '辞書データを解析中...'
      };
      updateUI();

      const lines = text.split('\n');
      const totalLines = lines.length;
      const parsedTags = [];
      const newIndex = new Map();

      for (let start = 0; start < totalLines; start += PARSE_BATCH_SIZE) {
        const end = Math.min(start + PARSE_BATCH_SIZE, totalLines);

        for (let i = start; i < end; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          // 行フォーマット: tag,category,count,aliases
          // 例: 1girl,0,6008644,"1girls,sole_female"
          const c1 = line.indexOf(',');
          const c2 = line.indexOf(',', c1 + 1);
          const c3 = line.indexOf(',', c2 + 1);

          if (c1 === -1 || c2 === -1) continue;

          const name = line.slice(0, c1);
          const category = Number(line.slice(c1 + 1, c2));
          const count = Number(line.slice(c2 + 1, c3 === -1 ? line.length : c3));

          let aliases = [];
          if (c3 !== -1 && c3 + 1 < line.length) {
            let rawAlias = line.slice(c3 + 1);
            if (rawAlias.charCodeAt(0) === 34 && rawAlias.charCodeAt(rawAlias.length - 1) === 34) {
              rawAlias = rawAlias.slice(1, -1);
            }
            if (rawAlias) {
              aliases = rawAlias.split(',');
            }
          }

          const item = { name, category, count, aliases };
          parsedTags.push(item);

          // 索引キーの収集 (先頭文字・単語区切り・エイリアス)
          const keys = new Set();

          // 1. タグ名の先頭文字と単語区切り文字
          if (name.length > 0) {
            keys.add(name[0].toLowerCase());
            const wordKeys = extractWordKeys(name);
            for (let w = 0; w < wordKeys.length; w++) {
              keys.add(wordKeys[w]);
            }
          }

          // 2. エイリアスの先頭文字と単語区切り文字
          for (let a = 0; a < aliases.length; a++) {
            const al = aliases[a];
            if (al.length > 0) {
              keys.add(al[0].toLowerCase());
              // /lh 等のスラッシュ付きエイリアスはスラッシュ直後の文字も索引に追加
              if (al.startsWith('/') && al.length > 1) {
                keys.add(al[1].toLowerCase());
              }
              const alWordKeys = extractWordKeys(al);
              for (let w = 0; w < alWordKeys.length; w++) {
                keys.add(alWordKeys[w]);
              }
            }
          }

          // 索引 Map への登録 (元の CSV が投稿数降順のため、バケット内も自動的に降順)
          for (const k of keys) {
            let bucket = newIndex.get(k);
            if (!bucket) {
              bucket = [];
              newIndex.set(k, bucket);
            }
            bucket.push(item);
          }
        }

        const parsePercent = Math.round((end / totalLines) * 100);
        const overallPercent = 45 + Math.round(parsePercent * 0.55);
        state.progress = {
          percent: Math.min(99, overallPercent),
          phase: 'indexing',
          detail: `索引を構築中... ${parsePercent}% (${end.toLocaleString()} / ${totalLines.toLocaleString()} 件)`
        };
        updateUI();

        // UI スレッドを定期的に解放
        await yieldToMain();
      }

      state.tags = parsedTags;
      state.index = newIndex;
      state.status = 'ready';
      state.progress = {
        percent: 100,
        phase: 'ready',
        detail: `Danbooru辞書: ${parsedTags.length.toLocaleString()}件 (準備完了)`
      };
      updateUI();

      // Tag input の補完プロバイダーとして PromptWorkbench に登録
      if (window.PromptWorkbench && typeof window.PromptWorkbench.setSuggestionsProvider === 'function') {
        window.PromptWorkbench.setSuggestionsProvider((query) => searchSuggestions(query));
      }

      if (window.PromptWorkbench && typeof window.PromptWorkbench.showToast === 'function' && forceReload) {
        window.PromptWorkbench.showToast(`辞書データを再読み込みしました (${parsedTags.length.toLocaleString()} 件)`);
      }
    } catch (err) {
      console.error('Danbooru dictionary loading error:', err);
      state.status = 'error';
      state.error = err;
      state.progress = {
        percent: 0,
        phase: 'error',
        detail: '辞書の読み込みに失敗しました（フリー入力は利用可能）'
      };
      updateUI();

      if (window.PromptWorkbench && typeof window.PromptWorkbench.showToast === 'function') {
        window.PromptWorkbench.showToast('辞書の読み込みに失敗しました（フリー入力は可能です）');
      }
    }
  }

  /**
   * 辞書候補の検索エンジン
   * SPEC.md §3.2 準拠：
   * - 入力クエリを先頭文字索引で絞り込み
   * - タグ名およびエイリアス（別名）から検索
   * - 完全一致を最優先、次いで使用頻度（投稿数）降順で並び替え
   * - カテゴリ番号（0:一般, 1:絵師, 3:版権, 4:キャラ, 5:メタ）を保持
   * 
   * @param {string} query - ユーザー入力文字列
   * @param {number} limit - 最大候補件数 (デフォルト 10件)
   * @returns {Array<Object>} 候補リスト
   */
  function searchSuggestions(query, limit = 10) {
    if (state.status !== 'ready' || state.tags.length === 0) {
      return [];
    }

    const q = (query || '').toLowerCase().trim();
    if (!q) return [];

    // Danbooru タグのスペースをアンダースコアに正規化
    const qNorm = q.replace(/\s+/g, '_');
    const qNoSlash = qNorm.startsWith('/') ? qNorm.slice(1) : qNorm;

    // 先頭文字で索引バケットを取得
    let firstChar = qNorm[0];
    let candidates = state.index.get(firstChar);

    // '/' 始まりのエイリアス (/lh など) または '/' なしの入力の相互引き当て
    if (!candidates && qNorm.startsWith('/')) {
      candidates = state.index.get(qNorm[1]);
    }

    // 索引キーが存在しない場合（特殊文字等）は全件をフォールバック検索
    const searchPool = candidates || state.tags;
    const matches = [];
    const seen = new Set();

    for (let i = 0; i < searchPool.length; i++) {
      const item = searchPool[i];
      if (seen.has(item.name)) continue;

      const nameLower = item.name.toLowerCase();
      let isExact = false;
      let matchedAlias = null;
      let isMatched = false;

      // 1. タグ名でのマッチング
      if (nameLower === qNorm) {
        isExact = true;
        isMatched = true;
      } else if (nameLower.startsWith(qNorm)) {
        isMatched = true;
      } else if (nameLower.includes('_' + qNorm) || nameLower.includes('(' + qNorm)) {
        isMatched = true;
      }

      // 2. エイリアスでのマッチング
      for (let a = 0; a < item.aliases.length; a++) {
        const al = item.aliases[a];
        const alLower = al.toLowerCase();
        const alNoSlash = alLower.startsWith('/') ? alLower.slice(1) : alLower;

        // 完全一致判定 (/ の有無を吸収)
        if (alLower === qNorm || (qNoSlash.length >= 2 && alNoSlash === qNoSlash)) {
          isExact = true;
          isMatched = true;
          matchedAlias = al;
          break;
        }

        // 前方一致判定
        if (alLower.startsWith(qNorm) || (qNoSlash.length >= 2 && alNoSlash.startsWith(qNoSlash))) {
          isMatched = true;
          matchedAlias = al;
          break;
        }

        // 単語境界一致判定
        if (alLower.includes('_' + qNorm) || alLower.includes('(' + qNorm)) {
          isMatched = true;
          if (!matchedAlias) matchedAlias = al;
        }
      }

      // 3. 部分一致フォールバック（クエリが3文字以上で未マッチの場合）
      if (!isMatched && qNorm.length >= 3 && nameLower.includes(qNorm)) {
        isMatched = true;
      }

      if (isMatched) {
        seen.add(item.name);
        matches.push({
          name: item.name,
          category: item.category,
          count: item.count,
          matchedAlias,
          isExact
        });

        // 検索レスポンス維持のため最大 80 件で探索を打ち切り
        if (matches.length >= 80) break;
      }
    }

    // ソート：完全一致を先頭に、同一ランク内では投稿数（使用頻度）降順
    matches.sort((a, b) => {
      if (a.isExact !== b.isExact) {
        return a.isExact ? -1 : 1;
      }
      return b.count - a.count;
    });

    return matches.slice(0, limit);
  }

  /* ==========================================================================
     イベントリスナー登録
     ========================================================================== */
  // 編集画面：再試行ボタン
  if (dictRetryBtn) {
    dictRetryBtn.addEventListener('click', () => {
      loadDictionary({ forceReload: true });
    });
  }

  // 管理画面：辞書再読み込みボタン
  if (dictReloadBtn) {
    dictReloadBtn.addEventListener('click', () => {
      loadDictionary({ forceReload: true });
    });
  }

  /* ==========================================================================
     API 公開 & 初期ロード開始
     ========================================================================== */
  window.PromptWorkbenchDictionary = {
    load: loadDictionary,
    search: searchSuggestions,
    getStatus: () => ({
      status: state.status,
      totalTags: state.tags.length,
      indexKeys: state.index.size,
      progress: { ...state.progress },
      error: state.error ? state.error.message : null
    })
  };

  // アプリ起動時に初回辞書読み込みを開始
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => loadDictionary());
  } else {
    loadDictionary();
  }
})();
