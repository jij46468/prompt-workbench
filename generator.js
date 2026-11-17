/**
 * プロンプト作業台 (Prompt Workbench)
 * 生成画面ロジック (テンプレート展開・シード付き乱数・辞書ランダム)
 *
 * - テンプレート展開：{a|b|c} 選択肢記法（入れ子対応）
 * - シード付き乱数 (mulberry32) による再現可能な生成列
 * - 生成個数指定 (1〜100)
 * - 辞書ランダムモード (T8): 辞書全件を基本とし、Danbooruカテゴリと
 *   人気上位%のフィルターで候補プールを絞って抽選する
 * - 生成結果は Expand card 一覧で表示 (T5)
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
     2. テンプレートパーサー & 選択肢展開エンジン
     ========================================================================== */

  const MAX_RECURSION_DEPTH = 25;

  /**
   * テキスト内の {a|b|c} 選択肢を再帰的に展開する
   * @param {string} text
   * @param {function(): number} rng mulberry32 乱数関数
   * @param {number} depth 現在の再帰深度
   * @param {Object} context 警告用オブジェクト
   * @returns {string} 展開後の文字列
   */
  function expandText(text, rng, depth, context) {
    if (typeof text !== 'string') return '';
    if (depth > MAX_RECURSION_DEPTH) {
      context.warnings.add('選択肢の入れ子が深すぎるため展開を中断しました (上限25階層)');
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
            result += expandText(chosen, rng, depth + 1, context);
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
   * @param {number} seed
   * @returns {Object} { prompt, seed, warnings }
   */
  function expandTemplate(template, seed) {
    const rng = createMulberry32(seed);
    const context = {
      warnings: new Set()
    };

    const raw = expandText(template, rng, 0, context);
    const cleaned = cleanPromptOutput(raw);

    return {
      prompt: cleaned,
      seed: seed,
      warnings: Array.from(context.warnings),
      usedWildcards: []
    };
  }

  /**
   * 辞書ランダムモード (T7): 人気プールの構築
   * tags: dictionary.js のタグ配列 [{ name, category, count, aliases }]
   * percent: 投稿数の上位 % (1〜100、既定100＝全件)
   * categories: 対象 Danbooru カテゴリ番号の Set (空なら全カテゴリ)
   * 戻り値: 投稿数降順に並んだプール配列（tags 自体は変更しない）
   */
  function buildPopularityPool(tags, percent, categories, groupTagSet) {
    const rawPct = Number(percent);
    const pct = Math.min(100, Math.max(1, Number.isFinite(rawPct) ? rawPct : 100));
    let base = tags;
    if (groupTagSet) {
      base = base.filter(t => groupTagSet.has(t.name));
    }
    const filtered = (categories && categories.size > 0)
      ? base.filter(t => categories.has(t.category))
      : base.slice();
    const sorted = filtered.slice().sort((a, b) => b.count - a.count);
    const size = Math.max(1, Math.ceil(sorted.length * pct / 100));
    return sorted.slice(0, size);
  }

  /**
   * 辞書ランダムモード (T7): プールから重複なしで n 件抽選する
   * 部分 Fisher-Yates シャッフルで先頭 n 件を取り出す。
   * 戻り値: タグ名の配列
   */
  function drawTagsFromPool(pool, n, rng) {
    const count = Math.min(Math.max(0, n | 0), pool.length);
    if (count === 0) return [];
    const copy = pool.slice();
    for (let i = 0; i < count; i++) {
      const j = i + Math.floor(rng() * (copy.length - i));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy.slice(0, count).map(t => t.name);
  }

  /* ==========================================================================
     3. 生成画面 UI コントローラー
     ========================================================================== */

  // 状態管理
  let currentMode = 'template'; // 'template' | 'dict'
  let currentResults = [];
  let resultIdSeq = 1;

  // デフォルトテンプレート例（汎用タグのみ）
  const DEFAULT_SAMPLE_TEMPLATE = '1girl, {short_hair|long_hair}, {smile|blush}, {outdoors|indoors}';

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
    const genModeDictBtn = document.getElementById('genModeDictBtn');
    const genTemplatePanel = document.getElementById('genTemplatePanel');
    const genDictPanel = document.getElementById('genDictPanel');
    const genDictPercentInput = document.getElementById('genDictPercentInput');
    const genDictTagsInput = document.getElementById('genDictTagsInput');
    const genDictPoolInfo = document.getElementById('genDictPoolInfo');
    const dictCategoryChecklist = document.getElementById('dictCategoryChecklist');
    const genGroupSelect = document.getElementById('genGroupSelect');
    const genGroupInfo = document.getElementById('genGroupInfo');

    // テンプレートパネル要素
    const genTemplateInput = document.getElementById('genTemplateInput');
    const genClearTemplateBtn = document.getElementById('genClearTemplateBtn');
    const syntaxChipChoice = document.getElementById('syntaxChipChoice');
    const syntaxChipSample = document.getElementById('syntaxChipSample');

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

      const modeBtns = [
        [genModeTemplateBtn, 'template'],
        [genModeDictBtn, 'dict']
      ];
      modeBtns.forEach(([btn, m]) => {
        if (!btn) return;
        const active = mode === m;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
      });

      if (genTemplatePanel) genTemplatePanel.hidden = mode !== 'template';
      if (genDictPanel) genDictPanel.hidden = mode !== 'dict';

      if (mode === 'dict') updateDictPoolInfo();
    }

    if (genModeTemplateBtn) {
      genModeTemplateBtn.addEventListener('click', () => setMode('template'));
    }
    if (genModeDictBtn) {
      genModeDictBtn.addEventListener('click', () => setMode('dict'));
    }

    /* ------------------------------------------------------------------------
       1b. 辞書ランダム (T7): プール情報表示
       ------------------------------------------------------------------------ */
    function getDictSelectedCategories() {
      const set = new Set();
      if (dictCategoryChecklist) {
        dictCategoryChecklist.querySelectorAll('input[type="checkbox"]:checked')
          .forEach(cb => set.add(Number(cb.value)));
      }
      return set;
    }

    function getDictPercent() {
      const v = genDictPercentInput ? Number(genDictPercentInput.value) : 100;
      if (!Number.isFinite(v)) return 100;
      return Math.min(100, Math.max(1, Math.round(v)));
    }

    function getDictTagsPerPrompt() {
      const v = genDictTagsInput ? Number(genDictTagsInput.value) : 5;
      if (!Number.isFinite(v)) return 5;
      return Math.min(30, Math.max(1, Math.round(v)));
    }

    function getDictGroupSet() {
      if (!genGroupSelect || !genGroupSelect.value) return null;
      const api = window.PromptWorkbenchGroups;
      if (!api || typeof api.getTagSet !== 'function') return null;
      return api.getTagSet(genGroupSelect.value);
    }

    function getDictGroupName() {
      if (!genGroupSelect || !genGroupSelect.value) return '';
      const opt = genGroupSelect.options[genGroupSelect.selectedIndex];
      return opt ? opt.textContent.replace(/（\d+件）$/, '') : '';
    }

    let groupSelectPopulated = false;
    function populateGroupSelect() {
      if (groupSelectPopulated || !genGroupSelect) return;
      const api = window.PromptWorkbenchGroups;
      const status = api && typeof api.getStatus === 'function' ? api.getStatus() : null;
      if (!status) return;
      if (status.status === 'error') {
        if (genGroupInfo) genGroupInfo.textContent = 'グループ分類の読み込みに失敗しました（絞り込みなしで利用できます）';
        groupSelectPopulated = true;
        return;
      }
      if (status.status !== 'ready') return;
      const groups = api.getGroups().slice().sort((a, b) =>
        (a.parent || '').localeCompare(b.parent || '') || b.tagCount - a.tagCount);
      const byParent = new Map();
      for (const g of groups) {
        const key = g.parent || 'その他';
        if (!byParent.has(key)) byParent.set(key, []);
        byParent.get(key).push(g);
      }
      for (const [parent, gs] of byParent) {
        const og = document.createElement('optgroup');
        og.label = parent;
        for (const g of gs) {
          const opt = document.createElement('option');
          opt.value = g.id;
          opt.textContent = `${g.name}（${g.tagCount}件）`;
          og.appendChild(opt);
        }
        genGroupSelect.appendChild(og);
      }
      if (genGroupInfo) {
        genGroupInfo.textContent = `Wikiのテーマ別分類 ${groups.length} グループから絞れます（例: hair styles、backgrounds、attire）`;
      }
      groupSelectPopulated = true;
    }

    function updateDictPoolInfo() {
      if (!genDictPoolInfo) return;
      const dict = window.PromptWorkbenchDictionary;
      const status = dict && typeof dict.getStatus === 'function' ? dict.getStatus() : null;
      if (!status || status.status !== 'ready') {
        genDictPoolInfo.textContent = status && status.status === 'error'
          ? '辞書の読み込みに失敗しました（管理画面から再読み込みできます）'
          : '辞書の読み込み中です…';
        return;
      }
      const allTags = dict.getAllTags();
      const groupSet = getDictGroupSet();
      const pool = buildPopularityPool(allTags, getDictPercent(), getDictSelectedCategories(), groupSet);
      if (pool.length === 0) {
        genDictPoolInfo.textContent = '候補プールが空です（カテゴリを選択してください）';
        return;
      }
      const minCount = pool[pool.length - 1].count;
      const pct = getDictPercent();
      const groupName = getDictGroupName();
      const scope = groupName ? `グループ「${groupName}」内 ` : '';
      genDictPoolInfo.textContent = pct >= 100
        ? `候補プール: ${pool.length.toLocaleString()} 件（${scope}選択カテゴリの全件が候補、最低投稿数 ${minCount.toLocaleString()}）`
        : `候補プール: ${pool.length.toLocaleString()} 件（${scope}対象 ${allTags.length.toLocaleString()} 件中 上位 ${pct}%、最低投稿数 ${minCount.toLocaleString()}）`;
    }

    if (genDictPercentInput) {
      genDictPercentInput.addEventListener('input', updateDictPoolInfo);
      genDictPercentInput.addEventListener('change', updateDictPoolInfo);
    }
    if (dictCategoryChecklist) {
      dictCategoryChecklist.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
          cb.closest('.category-card')?.classList.toggle('is-checked', cb.checked);
          updateDictPoolInfo();
        });
      });
    }
    if (genGroupSelect) {
      genGroupSelect.addEventListener('change', updateDictPoolInfo);
    }
    populateGroupSelect();
    const groupInfoTimer = setInterval(() => {
      populateGroupSelect();
      if (groupSelectPopulated) {
        clearInterval(groupInfoTimer);
        if (currentMode === 'dict') updateDictPoolInfo();
      }
    }, 1000);
    // 辞書の初回読み込み完了をプール情報へ反映（読み込み中のみ監視）
    const dictInfoTimer = setInterval(() => {
      const dict = window.PromptWorkbenchDictionary;
      const status = dict && typeof dict.getStatus === 'function' ? dict.getStatus() : null;
      if (status && (status.status === 'ready' || status.status === 'error')) {
        clearInterval(dictInfoTimer);
        if (currentMode === 'dict') updateDictPoolInfo();
      }
    }, 1000);

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
          const res = expandTemplate(template, itemSeed);
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
        // 辞書ランダムモード (T8): 全件を基本にフィルターで絞ったプールから重複なし抽選
        const dict = window.PromptWorkbenchDictionary;
        const status = dict && typeof dict.getStatus === 'function' ? dict.getStatus() : null;
        if (!dict || !status || status.status !== 'ready' || typeof dict.getAllTags !== 'function') {
          if (window.PromptWorkbench?.showToast) {
            window.PromptWorkbench.showToast('辞書の読み込みが完了していません');
          }
          return;
        }

        const categories = getDictSelectedCategories();
        if (categories.size === 0) {
          if (window.PromptWorkbench?.showToast) {
            window.PromptWorkbench.showToast('対象カテゴリを1つ以上選択してください');
          }
          return;
        }

        if (genGroupSelect && genGroupSelect.value) {
          const gApi = window.PromptWorkbenchGroups;
          const gStatus = gApi && typeof gApi.getStatus === 'function' ? gApi.getStatus() : null;
          if (!gStatus || gStatus.status !== 'ready') {
            if (window.PromptWorkbench?.showToast) {
              window.PromptWorkbench.showToast('グループ分類の読み込みが完了していません');
            }
            return;
          }
        }
        const pool = buildPopularityPool(dict.getAllTags(), getDictPercent(), categories, getDictGroupSet());
        if (pool.length === 0) {
          if (window.PromptWorkbench?.showToast) {
            window.PromptWorkbench.showToast('候補プールが空です');
          }
          return;
        }

        const tagsPerPrompt = getDictTagsPerPrompt();
        for (let i = 0; i < count; i++) {
          const itemSeed = (baseSeed + i) >>> 0;
          const rng = createMulberry32(itemSeed);
          const drawn = drawTagsFromPool(pool, tagsPerPrompt, rng);
          const warnings = [];
          if (tagsPerPrompt > pool.length) {
            warnings.push(`プール件数（${pool.length}件）より多いタグ数が指定されたため、${pool.length}件で生成しました`);
          }
          newResults.push({
            id: `gen_res_${Date.now()}_${resultIdSeq++}`,
            index: i + 1,
            seed: itemSeed,
            baseSeed: baseSeed,
            mode: 'dict',
            prompt: drawn.join(', '),
            warnings: warnings,
            usedWildcards: []
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
       6. 生成結果リスト描画 (T5 Expand card, SPEC §3.3)
       - 折りたたみ時: タグの先頭部分＋シード等のメタ情報を 1 行で表示
       - 展開時: プロンプト全文、警告、コピー、「編集へ送る」
       - 複数カードを同時に開いてよい
       ------------------------------------------------------------------------ */
    const expandedResultIds = new Set();

    function previewText(prompt) {
      if (!prompt) return '（空のプロンプト）';
      const tags = prompt.split(',').map(s => s.trim()).filter(Boolean);
      if (tags.length <= 3) return prompt;
      return tags.slice(0, 3).join(', ') + ' …';
    }

    function sendToEditor(item) {
      const wb = window.PromptWorkbench;
      if (!wb || typeof wb.addTag !== 'function') return;
      const tags = (item.prompt || '').split(',').map(s => s.trim()).filter(Boolean);
      if (tags.length === 0) return;
      if (typeof wb.clearAllTags === 'function') wb.clearAllTags();
      tags.forEach(t => wb.addTag(t));
      const editTab = document.getElementById('tab-edit');
      if (editTab) editTab.click();
      if (typeof wb.showToast === 'function') {
        wb.showToast(`プロンプト #${item.index} を編集画面に読み込みました`);
      }
    }

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
        card.className = 'gen-result-card expand-card';
        card.setAttribute('data-id', item.id);
        card.setAttribute('role', 'listitem');

        const hasWarnings = item.warnings && item.warnings.length > 0;
        const isExpanded = expandedResultIds.has(item.id);
        if (isExpanded) card.classList.add('is-expanded');

        card.innerHTML = `
          <button type="button" class="expand-card-header" aria-expanded="${isExpanded ? 'true' : 'false'}" aria-label="プロンプト #${item.index} の詳細を開閉">
            <span class="gen-result-index">#${item.index}</span>
            <span class="gen-result-preview">${escapeHtml(previewText(item.prompt))}</span>
            <span class="gen-result-seed">Seed: ${item.seed}</span>
            ${hasWarnings ? '<span class="gen-result-warning-pill">⚠️ 未定義あり</span>' : ''}
            <svg class="expand-card-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>

          <div class="expand-card-body">
            <div class="expand-card-body-inner">
              <div class="expand-card-content">
                <div class="gen-result-prompt">
                  ${escapeHtml(item.prompt || '（空のプロンプト）')}
                </div>

                ${hasWarnings ? `
                  <div class="gen-result-warnings">
                    ${item.warnings.map(w => `<span class="gen-warning-item">⚠️ ${escapeHtml(w)}</span>`).join('')}
                  </div>
                ` : ''}

                <div class="gen-result-actions">
                  <button type="button" class="btn-copy-result" aria-label="プロンプト #${item.index} をコピー">
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    <span>コピー</span>
                  </button>
                  <button type="button" class="btn-send-editor" aria-label="プロンプト #${item.index} を編集画面へ送る">
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M12 20h9"></path>
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                    </svg>
                    <span>編集へ送る</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        `;

        const headerBtn = card.querySelector('.expand-card-header');
        headerBtn.addEventListener('click', () => {
          const nowExpanded = card.classList.toggle('is-expanded');
          headerBtn.setAttribute('aria-expanded', nowExpanded ? 'true' : 'false');
          if (nowExpanded) {
            expandedResultIds.add(item.id);
          } else {
            expandedResultIds.delete(item.id);
          }
        });

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

        const sendBtn = card.querySelector('.btn-send-editor');
        sendBtn.addEventListener('click', () => sendToEditor(item));

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
    buildPopularityPool,
    drawTagsFromPool,
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
