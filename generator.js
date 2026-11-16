/**
 * プロンプト作業台 (Prompt Workbench)
 * T4: 生成画面ロジック (テンプレート展開・シード付き乱数・カテゴリ別ランダム)
 *
 * - テンプレート展開：{a|b|c} 選択肢記法（入れ子対応）
 * - ワイルドカード展開：__名前__ をデータストアから再帰展開（未定義はそのまま残し警告フラグ）
 * - シード付き乱数 (mulberry32) による再現可能な生成列
 * - 生成個数指定 (1〜100)
 * - カテゴリ別ランダムモード（ワイルドカード辞書からカテゴリON/OFF抽選）
 * - 生成結果データ生成と簡易一覧表示 (T5 Expand card で拡張予定)
 */

(function () {
  'use strict';

  /* ==========================================================================
     1. シード付き乱数生成器 (mulberry32) & シード処理
     ========================================================================== */

  /**
   * mulberry32 32bit PRNG 生成関数 (SPEC §4 準拠)
   * @param {number} seed 32bit 符号なし整数
   * @returns {function(): number} 0 以上 1 未満の浮動小数点数を返す乱数関数
   */
  function createMulberry32(seed) {
    let a = (seed >>> 0);
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * シード入力文字列を 32bit 整数値に変換
   * @param {string|number} val
   * @returns {number} 32bit unsigned integer
   */
  function parseSeedValue(val) {
    const str = (val === null || val === undefined) ? '' : String(val).trim();
    if (!str) {
      // 空欄時は暗号論的または現在時刻・Math.randomからランダム生成
      return Math.floor(Math.random() * 0xFFFFFFFF) >>> 0;
    }

    if (/^-?\d+$/.test(str)) {
      return parseInt(str, 10) >>> 0;
    }

    // 任意の文字列が入力された場合は FNV-1a 32bit ハッシュで確定的に数値化
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
    }
    return h >>> 0;
  }

  /* ==========================================================================
     2. テンプレートパーサー & ワイルドカード展開エンジン
     ========================================================================== */

  const MAX_RECURSION_DEPTH = 25;

  /**
   * テキスト内の {a|b|c} 選択肢および __名前__ ワイルドカードを再帰的に展開する
   * @param {string} text
   * @param {Object} wildcardStore { [name: string]: string[] }
   * @param {function(): number} rng mulberry32 乱数関数
   * @param {number} depth 現在の再帰深度
   * @param {Object} context 警告および使用追跡用オブジェクト
   * @returns {string} 展開後の文字列
   */
  function expandText(text, wildcardStore, rng, depth, context) {
    if (typeof text !== 'string') return '';
    if (depth > MAX_RECURSION_DEPTH) {
      context.warnings.add('ワイルドカードまたは選択肢の入れ子が深すぎるため展開を中断しました (上限25階層)');
      return text;
    }

    // --- 1. トップレベルの選択肢 {...} を展開 ---
    let result = '';
    let i = 0;
    const len = text.length;

    while (i < len) {
      if (text[i] === '{') {
        let braceDepth = 1;
        const start = i + 1;
        let j = start;
        const options = [];
        let currentOptionStart = start;

        while (j < len && braceDepth > 0) {
          if (text[j] === '{') {
            braceDepth++;
          } else if (text[j] === '}') {
            braceDepth--;
            if (braceDepth === 0) {
              options.push(text.slice(currentOptionStart, j));
              break;
            }
          } else if (text[j] === '|' && braceDepth === 1) {
            options.push(text.slice(currentOptionStart, j));
            currentOptionStart = j + 1;
          }
          j++;
        }

        if (braceDepth === 0) {
          if (options.length > 0) {
            // 乱数で選択肢を1つ選出
            const randomIndex = Math.floor(rng() * options.length);
            const chosen = options[Math.min(randomIndex, options.length - 1)];
            // 選出された選択肢をさらに再帰展開
            result += expandText(chosen, wildcardStore, rng, depth + 1, context);
          }
          i = j + 1;
        } else {
          // 閉じ括弧がない不正な brace はそのまま出力
          result += text[i];
          i++;
        }
      } else {
        result += text[i];
        i++;
      }
    }

    // --- 2. ワイルドカード __名前__ を展開 ---
    // 英数字・アンダースコア・ハイフン・スラッシュ・日本語を許容
    const wildcardRegex = /__([a-zA-Z0-9\-/\u3000-\u9FFF](?:[a-zA-Z0-9_\-/\u3000-\u9FFF]*?[a-zA-Z0-9\-/\u3000-\u9FFF])?)__/g;

    result = result.replace(wildcardRegex, (match, name) => {
      // 既に未定義と判定されたワイルドカードはそのまま残す
      if (context.undefinedWildcards.has(name)) {
        return match;
      }

      const items = wildcardStore ? wildcardStore[name] : null;
      if (!items || !Array.isArray(items) || items.length === 0) {
        // SPEC §4: 未定義のワイルドカードはそのまま残し、結果カードに警告を出す
        context.warnings.add(`未定義のワイルドカード: __${name}__`);
        context.undefinedWildcards.add(name);
        return match;
      }

      context.usedWildcards.add(name);
      const randomIndex = Math.floor(rng() * items.length);
      const chosenItem = items[Math.min(randomIndex, items.length - 1)];

      // 項目自体に choice や別ワイルドカードが含まれる可能性があるため再帰展開
      return expandText(chosenItem, wildcardStore, rng, depth + 1, context);
    });

    return result;
  }

  /**
   * カンマや空白の整形
   * @param {string} str
   * @returns {string}
   */
  function cleanPromptOutput(str) {
    if (!str) return '';
    return str
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join(', ')
      .replace(/\s*,\s*/g, ', ')
      .replace(/^,\s*|,\s*$/g, '')
      .trim();
  }

  /**
   * テンプレートから1つのプロンプトを展開
   * @param {string} template
   * @param {Object} wildcardStore
   * @param {number} seed
   * @returns {Object} { prompt, seed, warnings, usedWildcards }
   */
  function expandTemplate(template, wildcardStore, seed) {
    const rng = createMulberry32(seed);
    const context = {
      warnings: new Set(),
      usedWildcards: new Set(),
      undefinedWildcards: new Set()
    };

    const raw = expandText(template, wildcardStore, rng, 0, context);
    const cleaned = cleanPromptOutput(raw);

    return {
      prompt: cleaned,
      seed: seed,
      warnings: Array.from(context.warnings),
      usedWildcards: Array.from(context.usedWildcards)
    };
  }

  /**
   * カテゴリ別ランダムモードから1つのプロンプトを生成
   * @param {string[]} selectedCategories
   * @param {string} basePrefix
   * @param {Object} wildcardStore
   * @param {number} seed
   * @returns {Object} { prompt, seed, warnings, usedWildcards }
   */
  function generateCategoryPrompt(selectedCategories, basePrefix, wildcardStore, seed) {
    const rng = createMulberry32(seed);
    const context = {
      warnings: new Set(),
      usedWildcards: new Set(),
      undefinedWildcards: new Set()
    };

    const parts = [];

    // 固定プレフィックス（任意）の展開
    const prefixTrimmed = (basePrefix || '').trim();
    if (prefixTrimmed) {
      const expandedPrefix = expandText(prefixTrimmed, wildcardStore, rng, 0, context);
      if (expandedPrefix) {
        parts.push(expandedPrefix);
      }
    }

    // 選択された各カテゴリから1件ずつ抽選
    for (const catName of selectedCategories) {
      const items = wildcardStore ? wildcardStore[catName] : null;
      if (items && Array.isArray(items) && items.length > 0) {
        context.usedWildcards.add(catName);
        const idx = Math.floor(rng() * items.length);
        const item = items[Math.min(idx, items.length - 1)];
        const expandedItem = expandText(item, wildcardStore, rng, 1, context);
        if (expandedItem) {
          parts.push(expandedItem);
        }
      }
    }

    const raw = parts.join(', ');
    const cleaned = cleanPromptOutput(raw);

    return {
      prompt: cleaned,
      seed: seed,
      warnings: Array.from(context.warnings),
      usedWildcards: Array.from(context.usedWildcards)
    };
  }

  /* ==========================================================================
     3. 生成画面 UI コントローラー
     ========================================================================== */

  // 状態管理
  let currentMode = 'template'; // 'template' | 'category'
  let currentResults = [];
  let resultIdSeq = 1;

  // デフォルトテンプレート例（汎用タグのみ）
  const DEFAULT_SAMPLE_TEMPLATE = '1girl, {short_hair|long_hair}, __衣装__, __背景__';

  /**
   * HTMLエスケープ
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * クリップボードコピーヘルパー
   * @param {string} text
   * @returns {Promise<boolean>}
   */
  async function copyTextToClipboard(text) {
    if (!text) return false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      console.warn('Copy failed:', e);
      return false;
    }
  }

  /**
   * 生成画面の初期化
   */
  function initGenerator() {
    // DOM 要素取得
    const genModeTemplateBtn = document.getElementById('genModeTemplateBtn');
    const genModeCategoryBtn = document.getElementById('genModeCategoryBtn');
    const genTemplatePanel = document.getElementById('genTemplatePanel');
    const genCategoryPanel = document.getElementById('genCategoryPanel');

    // テンプレートパネル要素
    const genTemplateInput = document.getElementById('genTemplateInput');
    const genClearTemplateBtn = document.getElementById('genClearTemplateBtn');
    const syntaxChipChoice = document.getElementById('syntaxChipChoice');
    const syntaxChipWildcard = document.getElementById('syntaxChipWildcard');
    const syntaxChipSample = document.getElementById('syntaxChipSample');

    // カテゴリパネル要素
    const genCategoryPrefix = document.getElementById('genCategoryPrefix');
    const categoryActiveCounter = document.getElementById('categoryActiveCounter');
    const categorySelectAllBtn = document.getElementById('categorySelectAllBtn');
    const categoryDeselectAllBtn = document.getElementById('categoryDeselectAllBtn');
    const categoryChecklist = document.getElementById('categoryChecklist');

    // 生成設定要素
    const genCountInput = document.getElementById('genCountInput');
    const genCountDecBtn = document.getElementById('genCountDecBtn');
    const genCountIncBtn = document.getElementById('genCountIncBtn');
    const genSeedInput = document.getElementById('genSeedInput');
    const genSeedDiceBtn = document.getElementById('genSeedDiceBtn');
    const runGenerateBtn = document.getElementById('runGenerateBtn');
    const runGenerateBtnText = document.getElementById('runGenerateBtnText');

    // 生成結果エリア要素
    const genResultsBadge = document.getElementById('genResultsBadge');
    const genCopyAllBtn = document.getElementById('genCopyAllBtn');
    const genClearResultsBtn = document.getElementById('genClearResultsBtn');
    const genResultsEmpty = document.getElementById('genResultsEmpty');
    const genResultsList = document.getElementById('genResultsList');

    if (!runGenerateBtn) {
      console.warn('Generator UI elements not found on this page.');
      return;
    }

    // 初期値設定
    if (genTemplateInput && !genTemplateInput.value) {
      genTemplateInput.value = DEFAULT_SAMPLE_TEMPLATE;
    }

    /* ------------------------------------------------------------------------
       1. 生成モード切り替え
       ------------------------------------------------------------------------ */
    function setMode(mode) {
      currentMode = mode;
      const isTemplate = mode === 'template';

      if (genModeTemplateBtn) {
        genModeTemplateBtn.classList.toggle('active', isTemplate);
        genModeTemplateBtn.setAttribute('aria-selected', isTemplate ? 'true' : 'false');
      }
      if (genModeCategoryBtn) {
        genModeCategoryBtn.classList.toggle('active', !isTemplate);
        genModeCategoryBtn.setAttribute('aria-selected', !isTemplate ? 'true' : 'false');
      }

      if (genTemplatePanel) genTemplatePanel.hidden = !isTemplate;
      if (genCategoryPanel) genCategoryPanel.hidden = isTemplate;
    }

    if (genModeTemplateBtn) {
      genModeTemplateBtn.addEventListener('click', () => setMode('template'));
    }
    if (genModeCategoryBtn) {
      genModeCategoryBtn.addEventListener('click', () => setMode('category'));
    }

    /* ------------------------------------------------------------------------
       2. テンプレート構文チップ入力補助
       ------------------------------------------------------------------------ */
    function insertIntoTemplate(insertText, selectOffset = 0) {
      if (!genTemplateInput) return;
      genTemplateInput.focus();
      const start = genTemplateInput.selectionStart;
      const end = genTemplateInput.selectionEnd;
      const val = genTemplateInput.value;

      genTemplateInput.value = val.substring(0, start) + insertText + val.substring(end);
      const newPos = start + insertText.length - selectOffset;
      genTemplateInput.setSelectionRange(newPos, newPos);
    }

    if (syntaxChipChoice) {
      syntaxChipChoice.addEventListener('click', () => {
        insertIntoTemplate('{option1|option2}');
      });
    }

    if (syntaxChipWildcard) {
      syntaxChipWildcard.addEventListener('click', () => {
        const store = window.PromptWorkbench?.store;
        const names = store ? store.getWildcardNames() : [];
        const sampleName = names.length > 0 ? names[0] : '名前';
        insertIntoTemplate(`__${sampleName}__`);
      });
    }

    if (syntaxChipSample) {
      syntaxChipSample.addEventListener('click', () => {
        if (genTemplateInput) {
          genTemplateInput.value = DEFAULT_SAMPLE_TEMPLATE;
          genTemplateInput.focus();
          if (window.PromptWorkbench?.showToast) {
            window.PromptWorkbench.showToast('サンプルテンプレートを投入しました');
          }
        }
      });
    }

    if (genClearTemplateBtn) {
      genClearTemplateBtn.addEventListener('click', () => {
        if (genTemplateInput) {
          genTemplateInput.value = '';
          genTemplateInput.focus();
        }
      });
    }

    /* ------------------------------------------------------------------------
       3. カテゴリチェックリスト描画
       ------------------------------------------------------------------------ */
    function renderCategoryChecklist() {
      if (!categoryChecklist) return;

      const store = window.PromptWorkbench?.store;
      const wildcards = store ? store.getWildcards() : {};
      const categoryNames = Object.keys(wildcards);

      // 既存のチェック状態を記憶
      const previousChecks = new Set();
      const currentInputs = categoryChecklist.querySelectorAll('input[type="checkbox"]');
      if (currentInputs.length > 0) {
        currentInputs.forEach(input => {
          if (input.checked) previousChecks.add(input.value);
        });
      } else {
        // 初回はすべてのカテゴリをON
        categoryNames.forEach(n => previousChecks.add(n));
      }

      categoryChecklist.innerHTML = '';

      if (categoryNames.length === 0) {
        categoryChecklist.innerHTML = '<div class="category-empty-notice">登録されているワイルドカードがありません（管理画面で追加可能）</div>';
        updateCategoryCountBadge();
        return;
      }

      categoryNames.forEach((name, idx) => {
        const items = wildcards[name] || [];
        const isChecked = previousChecks.has(name);

        const card = document.createElement('label');
        card.className = `category-card${isChecked ? ' is-checked' : ''}`;
        card.setAttribute('for', `cat_cb_${idx}`);

        const previewText = items.slice(0, 3).join(', ') + (items.length > 3 ? '...' : '');

        card.innerHTML = `
          <input
            type="checkbox"
            id="cat_cb_${idx}"
            class="category-checkbox"
            value="${escapeHtml(name)}"
            ${isChecked ? 'checked' : ''}
          >
          <div class="category-info">
            <div class="category-title-row">
              <span class="category-name">${escapeHtml(name)}</span>
              <span class="category-items-count">${items.length}件</span>
            </div>
            <span class="category-preview-text">${escapeHtml(previewText)}</span>
          </div>
        `;

        const checkbox = card.querySelector('input[type="checkbox"]');
        if (checkbox) {
          checkbox.addEventListener('change', () => {
            card.classList.toggle('is-checked', checkbox.checked);
            updateCategoryCountBadge();
          });
        }

        categoryChecklist.appendChild(card);
      });

      updateCategoryCountBadge();
    }

    function updateCategoryCountBadge() {
      if (!categoryActiveCounter || !categoryChecklist) return;
      const total = categoryChecklist.querySelectorAll('input[type="checkbox"]').length;
      const checked = categoryChecklist.querySelectorAll('input[type="checkbox"]:checked').length;
      categoryActiveCounter.textContent = `${checked} / ${total} 選択中`;
    }

    if (categorySelectAllBtn) {
      categorySelectAllBtn.addEventListener('click', () => {
        if (!categoryChecklist) return;
        const boxes = categoryChecklist.querySelectorAll('input[type="checkbox"]');
        boxes.forEach(cb => {
          cb.checked = true;
          cb.closest('.category-card')?.classList.add('is-checked');
        });
        updateCategoryCountBadge();
      });
    }

    if (categoryDeselectAllBtn) {
      categoryDeselectAllBtn.addEventListener('click', () => {
        if (!categoryChecklist) return;
        const boxes = categoryChecklist.querySelectorAll('input[type="checkbox"]');
        boxes.forEach(cb => {
          cb.checked = false;
          cb.closest('.category-card')?.classList.remove('is-checked');
        });
        updateCategoryCountBadge();
      });
    }

    // ストアの変更を購読
    if (window.PromptWorkbench?.store?.subscribeWildcards) {
      window.PromptWorkbench.store.subscribeWildcards(() => {
        renderCategoryChecklist();
      });
    }
    renderCategoryChecklist();

    /* ------------------------------------------------------------------------
       4. 個数・シード設定コントローラー
       ------------------------------------------------------------------------ */
    function getCountValue() {
      if (!genCountInput) return 5;
      let val = parseInt(genCountInput.value, 10);
      if (isNaN(val) || val < 1) val = 1;
      if (val > 100) val = 100;
      return val;
    }

    function setCountValue(newVal) {
      if (!genCountInput) return;
      let val = newVal;
      if (val < 1) val = 1;
      if (val > 100) val = 100;
      genCountInput.value = String(val);
      updateGenerateButtonText();
    }

    function updateGenerateButtonText() {
      const count = getCountValue();
      if (runGenerateBtnText) {
        runGenerateBtnText.textContent = `プロンプト生成 (${count}件)`;
      }
    }

    if (genCountInput) {
      genCountInput.addEventListener('input', () => {
        updateGenerateButtonText();
      });
      genCountInput.addEventListener('change', () => {
        setCountValue(getCountValue());
      });
    }

    if (genCountDecBtn) {
      genCountDecBtn.addEventListener('click', () => {
        setCountValue(getCountValue() - 1);
      });
    }

    if (genCountIncBtn) {
      genCountIncBtn.addEventListener('click', () => {
        setCountValue(getCountValue() + 1);
      });
    }

    if (genSeedDiceBtn) {
      genSeedDiceBtn.addEventListener('click', () => {
        if (!genSeedInput) return;
        if (genSeedInput.value.trim()) {
          // 既に何か入っているときはクリア（ランダムに戻す）
          genSeedInput.value = '';
          if (window.PromptWorkbench?.showToast) {
            window.PromptWorkbench.showToast('シードをランダムに設定しました');
          }
        } else {
          // 空欄のときはランダムな数値を明示代入
          const rnd = Math.floor(Math.random() * 0xFFFFFFFF) >>> 0;
          genSeedInput.value = String(rnd);
          if (window.PromptWorkbench?.showToast) {
            window.PromptWorkbench.showToast(`シード: ${rnd} を設定しました`);
          }
        }
      });
    }

    /* ------------------------------------------------------------------------
       5. 生成実行ロジック
       ------------------------------------------------------------------------ */
    function runGeneration() {
      const store = window.PromptWorkbench?.store;
      const wildcards = store ? store.getWildcards() : {};
      const count = getCountValue();
      const rawSeedInput = genSeedInput ? genSeedInput.value.trim() : '';
      const baseSeed = parseSeedValue(rawSeedInput);

      const newResults = [];

      if (currentMode === 'template') {
        const template = (genTemplateInput ? genTemplateInput.value : '').trim();
        if (!template) {
          if (window.PromptWorkbench?.showToast) {
            window.PromptWorkbench.showToast('テンプレートを入力してください');
          }
          if (genTemplateInput) genTemplateInput.focus();
          return;
        }

        // SPEC §4: 生成個数 1〜100 の生成列を展開（各回独立シード (baseSeed + i) 準拠）
        for (let i = 0; i < count; i++) {
          const itemSeed = (baseSeed + i) >>> 0;
          const res = expandTemplate(template, wildcards, itemSeed);
          newResults.push({
            id: `gen_res_${Date.now()}_${resultIdSeq++}`,
            index: i + 1,
            seed: itemSeed,
            baseSeed: baseSeed,
            mode: 'template',
            prompt: res.prompt,
            warnings: res.warnings,
            usedWildcards: res.usedWildcards
          });
        }
      } else {
        // カテゴリ別ランダムモード
        const prefix = genCategoryPrefix ? genCategoryPrefix.value : '';
        const selectedCategories = [];
        if (categoryChecklist) {
          const checked = categoryChecklist.querySelectorAll('input[type="checkbox"]:checked');
          checked.forEach(cb => selectedCategories.push(cb.value));
        }

        if (selectedCategories.length === 0 && !prefix.trim()) {
          if (window.PromptWorkbench?.showToast) {
            window.PromptWorkbench.showToast('対象カテゴリを1つ以上選択してください');
          }
          return;
        }

        for (let i = 0; i < count; i++) {
          const itemSeed = (baseSeed + i) >>> 0;
          const res = generateCategoryPrompt(selectedCategories, prefix, wildcards, itemSeed);
          newResults.push({
            id: `gen_res_${Date.now()}_${resultIdSeq++}`,
            index: i + 1,
            seed: itemSeed,
            baseSeed: baseSeed,
            mode: 'category',
            prompt: res.prompt,
            warnings: res.warnings,
            usedWildcards: res.usedWildcards
          });
        }
      }

      // 生成結果を画面内に保持
      currentResults = newResults;
      renderResultsList();

      if (window.PromptWorkbench?.showToast) {
        window.PromptWorkbench.showToast(`${count} 件のプロンプトを生成しました (Seed: ${baseSeed})`);
      }
    }

    if (runGenerateBtn) {
      runGenerateBtn.addEventListener('click', runGeneration);
    }

    /* ------------------------------------------------------------------------
       6. 生成結果リスト描画 (T4 簡易一覧 / T5 Expand card で拡張予定)
       ------------------------------------------------------------------------ */
    function renderResultsList() {
      if (!genResultsList || !genResultsEmpty) return;

      const count = currentResults.length;
      if (genResultsBadge) {
        genResultsBadge.textContent = `${count} 件`;
      }
      if (genCopyAllBtn) {
        genCopyAllBtn.disabled = count === 0;
      }
      if (genClearResultsBtn) {
        genClearResultsBtn.disabled = count === 0;
      }

      if (count === 0) {
        genResultsEmpty.hidden = false;
        genResultsList.hidden = true;
        genResultsList.innerHTML = '';
        return;
      }

      genResultsEmpty.hidden = true;
      genResultsList.hidden = false;
      genResultsList.innerHTML = '';

      currentResults.forEach(item => {
        const card = document.createElement('div');
        card.className = 'gen-result-card';
        card.setAttribute('data-id', item.id);
        card.setAttribute('role', 'listitem');

        const hasWarnings = item.warnings && item.warnings.length > 0;

        card.innerHTML = `
          <div class="gen-result-header">
            <div class="gen-result-meta">
              <span class="gen-result-index">#${item.index}</span>
              <span class="gen-result-seed">Seed: ${item.seed}</span>
              ${hasWarnings ? '<span class="gen-result-warning-pill">⚠️ 未定義あり</span>' : ''}
            </div>
            <button type="button" class="btn-copy-result" aria-label="プロンプト #${item.index} をコピー">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>コピー</span>
            </button>
          </div>

          <div class="gen-result-prompt">
            ${escapeHtml(item.prompt || '（空のプロンプト）')}
          </div>

          ${hasWarnings ? `
            <div class="gen-result-warnings">
              ${item.warnings.map(w => `<span class="gen-warning-item">⚠️ ${escapeHtml(w)}</span>`).join('')}
            </div>
          ` : ''}
        `;

        const copyBtn = card.querySelector('.btn-copy-result');
        copyBtn.addEventListener('click', async () => {
          const ok = await copyTextToClipboard(item.prompt);
          if (ok) {
            const btnSpan = copyBtn.querySelector('span');
            const originalText = btnSpan.textContent;
            copyBtn.classList.add('is-copied');
            btnSpan.textContent = 'コピー完了!';
            setTimeout(() => {
              copyBtn.classList.remove('is-copied');
              btnSpan.textContent = originalText;
            }, 1800);

            if (window.PromptWorkbench?.showToast) {
              window.PromptWorkbench.showToast(`プロンプト #${item.index} をコピーしました`);
            }
          }
        });

        genResultsList.appendChild(card);
      });
    }

    /* ------------------------------------------------------------------------
       7. 全件コピー & 結果クリア
       ------------------------------------------------------------------------ */
    if (genCopyAllBtn) {
      genCopyAllBtn.addEventListener('click', async () => {
        if (currentResults.length === 0) return;
        const allText = currentResults.map(r => r.prompt).join('\n\n');
        const ok = await copyTextToClipboard(allText);
        if (ok && window.PromptWorkbench?.showToast) {
          window.PromptWorkbench.showToast(`${currentResults.length} 件の全結果をコピーしました`);
        }
      });
    }

    if (genClearResultsBtn) {
      genClearResultsBtn.addEventListener('click', () => {
        currentResults = [];
        renderResultsList();
        if (window.PromptWorkbench?.showToast) {
          window.PromptWorkbench.showToast('生成結果をクリアしました');
        }
      });
    }

    updateGenerateButtonText();
  }

  // API エクスポート
  window.PromptWorkbench = window.PromptWorkbench || {};
  window.PromptWorkbench.generator = {
    createMulberry32,
    parseSeedValue,
    expandTemplate,
    generateCategoryPrompt,
    getResults: () => currentResults.map(r => ({ ...r })),
    clearResults: () => {
      currentResults = [];
      const genResultsEmpty = document.getElementById('genResultsEmpty');
      const genResultsList = document.getElementById('genResultsList');
      const genResultsBadge = document.getElementById('genResultsBadge');
      if (genResultsBadge) genResultsBadge.textContent = '0 件';
      if (genResultsEmpty) genResultsEmpty.hidden = false;
      if (genResultsList) {
        genResultsList.hidden = true;
        genResultsList.innerHTML = '';
      }
    }
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initGenerator);
    } else {
      initGenerator();
    }
  }
})();
