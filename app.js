/**
 * プロンプト作業台 (Prompt Workbench)
 * T1: アプリ骨格 & Tab pill ナビゲーション
 */

/**
 * プロンプト作業台 (Prompt Workbench)
 * T1: アプリ骨格 & Tab pill ナビゲーション
 * T2: Tag input コンポーネント (チップ化・削除・補完枠組み・プレビュー & コピー)
 */

(function () {
  'use strict';

  /* ==========================================================================
     1. タブナビゲーション (3.1 Tab pill)
     ========================================================================== */
  const tabTrack = document.querySelector('.tab-pill-track');
  const tabSlider = document.getElementById('tabPillSlider');
  const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
  const screens = Array.from(document.querySelectorAll('.screen'));

  if (!tabTrack || !tabSlider || tabButtons.length === 0) {
    console.error('Tab pill elements not found.');
    return;
  }

  /**
   * スライダーピルの位置と幅を更新する
   * @param {HTMLElement} activeTab - 選択中のタブボタン
   * @param {boolean} animate - アニメーションさせるかどうか
   */
  function updateSliderPosition(activeTab, animate = true) {
    if (!activeTab) return;

    if (!animate) {
      tabSlider.classList.add('no-transition');
    }

    const left = activeTab.offsetLeft;
    const width = activeTab.offsetWidth;

    tabSlider.style.transform = `translateX(${left}px)`;
    tabSlider.style.width = `${width}px`;

    if (!animate) {
      void tabSlider.offsetHeight;
      requestAnimationFrame(() => {
        tabSlider.classList.remove('no-transition');
      });
    }
  }

  /**
   * 画面とタブのアクティブ状態を切り替える
   * @param {HTMLElement} targetTab - 切り替え先タブボタン
   * @param {boolean} animate - スライダーをアニメーションさせるか
   * @param {boolean} updateHistory - URLハッシュを更新するか
   */
  function switchTab(targetTab, animate = true, updateHistory = true) {
    if (!targetTab) return;

    const targetScreenId = targetTab.getAttribute('data-screen');
    if (!targetScreenId) return;

    // タブ切り替え時にドロップダウンが開いていたら閉じる
    if (typeof closeDropdown === 'function') {
      closeDropdown();
    }

    // 1. タブボタンの状態更新 (ARIA & クラス)
    tabButtons.forEach(btn => {
      const isSelected = btn === targetTab;
      btn.classList.toggle('active', isSelected);
      btn.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      btn.setAttribute('tabindex', isSelected ? '0' : '-1');
    });

    // 2. ピル位置更新 (バネ感のあるイージングでスライド)
    updateSliderPosition(targetTab, animate);

    // 3. 画面の表示切り替え
    screens.forEach(screen => {
      if (screen.id === targetScreenId) {
        screen.hidden = false;
        screen.classList.add('active');
      } else {
        screen.hidden = true;
        screen.classList.remove('active');
      }
    });

    // 4. URLハッシュ更新
    if (updateHistory) {
      const hashName = targetScreenId.replace('screen-', '');
      if (window.location.hash !== `#${hashName}`) {
        history.replaceState(null, '', `#${hashName}`);
      }
    }
  }

  /**
   * ハッシュまたは初期状態からアクティブタブを決定して適用
   */
  function applyInitialTab() {
    const hash = window.location.hash.replace('#', '');
    let matchedTab = null;

    if (hash) {
      matchedTab = tabButtons.find(btn => {
        const screenId = btn.getAttribute('data-screen');
        return screenId === `screen-${hash}` || screenId === hash;
      });
    }

    if (!matchedTab) {
      matchedTab = tabButtons.find(btn => btn.classList.contains('active')) || tabButtons[0];
    }

    switchTab(matchedTab, false, false);
  }

  /**
   * キーボードナビゲーション（WAI-ARIA Tabs パターン準拠）
   * @param {KeyboardEvent} event
   */
  function handleTabKeydown(event) {
    const currentTab = event.currentTarget;
    const currentIndex = tabButtons.indexOf(currentTab);
    if (currentIndex === -1) return;

    let targetIndex = null;

    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        targetIndex = (currentIndex - 1 + tabButtons.length) % tabButtons.length;
        break;
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        targetIndex = (currentIndex + 1) % tabButtons.length;
        break;
      case 'Home':
        event.preventDefault();
        targetIndex = 0;
        break;
      case 'End':
        event.preventDefault();
        targetIndex = tabButtons.length - 1;
        break;
      default:
        return;
    }

    if (targetIndex !== null) {
      const targetTab = tabButtons[targetIndex];
      targetTab.focus();
      switchTab(targetTab, true, true);
    }
  }

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn, true, true);
    });
    btn.addEventListener('keydown', handleTabKeydown);
  });

  window.addEventListener('resize', () => {
    const activeTab = tabButtons.find(btn => btn.classList.contains('active'));
    if (activeTab) {
      updateSliderPosition(activeTab, false);
    }
  });

  if (window.ResizeObserver) {
    const resizeObserver = new ResizeObserver(() => {
      const activeTab = tabButtons.find(btn => btn.classList.contains('active'));
      if (activeTab) {
        updateSliderPosition(activeTab, false);
      }
    });
    resizeObserver.observe(tabTrack);
  }

  window.addEventListener('hashchange', () => {
    applyInitialTab();
  });


  /* ==========================================================================
     2. 編集画面 Tag input & プレビュー (3.2 Tag input & 2.1 プレビュー)
     ========================================================================== */

  // DOM 要素の取得
  const tagInputContainer = document.getElementById('tagInputContainer');
  const tagInputBox = document.getElementById('tagInputBox');
  const tagChipsList = document.getElementById('tagChipsList');
  const tagInputField = document.getElementById('tagInputField');
  const tagCounterBadge = document.getElementById('tagCounterBadge');
  const clearAllTagsBtn = document.getElementById('clearAllTagsBtn');

  const tagSuggestionsDropdown = document.getElementById('tagSuggestionsDropdown');
  const suggestionsCount = document.getElementById('suggestionsCount');
  const suggestionsList = document.getElementById('suggestionsList');

  const promptPreviewText = document.getElementById('promptPreviewText');
  const copyPromptBtn = document.getElementById('copyPromptBtn');
  const copyPromptBtnText = document.getElementById('copyPromptBtnText');
  const copyToast = document.getElementById('copyToast');

  // カテゴリ番号の名称マップ
  const CATEGORY_NAMES = {
    0: '一般',
    1: '絵師',
    3: '版権',
    4: 'キャラ',
    5: 'メタ'
  };

  /**
   * T2用仮補完データ (汎用的な英単語タグ・Danbooru準拠)
   * ※ T3にて data/danbooru.csv の全件インデックスに差し替え可能
   */
  const DUMMY_TAG_SUGGESTIONS = [
    { name: '1girl', category: 0, count: 6008644, aliases: ['1girls', 'sole_female'] },
    { name: 'highres', category: 5, count: 5256195, aliases: ['high_res', 'hires'] },
    { name: 'solo', category: 0, count: 5000954, aliases: ['female_solo', 'solo_female'] },
    { name: 'long_hair', category: 0, count: 4350743, aliases: ['/lh', 'longhair'] },
    { name: 'looking_at_viewer', category: 0, count: 3315722, aliases: ['/lav', 'pov_eye_contact'] },
    { name: 'blush', category: 0, count: 2942792, aliases: ['blushing', 'flushed'] },
    { name: 'smile', category: 0, count: 2873890, aliases: [':)', 'smiling'] },
    { name: 'open_mouth', category: 0, count: 2365905, aliases: ['mouth_open'] },
    { name: 'short_hair', category: 0, count: 2261608, aliases: ['short-hair', 'shorthair'] },
    { name: 'simple_background', category: 0, count: 1821185, aliases: ['/sbg', 'simplebg'] },
    { name: 'shirt', category: 0, count: 1816895, aliases: ['shirts'] },
    { name: 'absurdres', category: 5, count: 1782391, aliases: ['insaneres', 'very_high_resolution'] },
    { name: 'blue_eyes', category: 0, count: 1762765, aliases: ['blueeyes', 'light_blue_eyes'] },
    { name: 'skirt', category: 0, count: 1557883, aliases: [] },
    { name: 'black_hair', category: 0, count: 1504581, aliases: ['blackhair', 'dark_hair'] },
    { name: 'standing', category: 0, count: 1450200, aliases: ['stand'] },
    { name: 'school_uniform', category: 0, count: 1205400, aliases: ['uniform'] },
    { name: 'white_background', category: 0, count: 1180000, aliases: ['whitebg'] },
    { name: 'masterpiece', category: 5, count: 1100000, aliases: ['best_quality'] },
    { name: 'original', category: 3, count: 1167308, aliases: ['/o', 'original_character'] },
    { name: 'hatsune_miku', category: 4, count: 106634, aliases: ['/hm', 'miku'] },
    { name: 'monochrome', category: 0, count: 850000, aliases: ['greyscale'] }
  ];

  // タグ状態管理: { id: string, text: string, isSnippet: boolean }
  let tags = [];
  let tagIdSeed = 1;

  // 補完候補状態管理
  let currentSuggestions = [];
  let activeSuggestionIndex = -1;
  let customSuggestionsProvider = null; // T3連携用フック

  /**
   * 使用頻度数値をフォーマット (例: 6008644 -> 6.0M, 90300 -> 90.3k)
   * @param {number} num
   * @returns {string}
   */
  function formatCount(num) {
    if (typeof num !== 'number') return '';
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    }
    return num.toLocaleString();
  }

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
   * タグを追加する
   * カンマ区切りの文字列が渡された場合は分割して追加
   * @param {string} rawText
   * @param {boolean} isSnippet - スニペット由来フラグ
   * @returns {boolean} 追加されたかどうか
   */
  function addTag(rawText, isSnippet = false) {
    const trimmed = (rawText || '').trim();
    if (!trimmed) return false;

    // カンマまたは読点が含まれている場合は分割して順次追加
    if (trimmed.includes(',') || trimmed.includes('、')) {
      const parts = trimmed.split(/[,、]/);
      let anyAdded = false;
      for (const part of parts) {
        if (addTag(part, isSnippet)) {
          anyAdded = true;
        }
      }
      return anyAdded;
    }

    const newTag = {
      id: `tag_${Date.now()}_${tagIdSeed++}`,
      text: trimmed,
      isSnippet: Boolean(isSnippet)
    };

    tags.push(newTag);
    renderChips();
    updatePreview();
    return true;
  }

  /**
   * 特定のIDのタグを削除
   * @param {string} tagId
   */
  function removeTag(tagId) {
    const index = tags.findIndex(t => t.id === tagId);
    if (index !== -1) {
      tags.splice(index, 1);
      renderChips();
      updatePreview();
    }
  }

  /**
   * 末尾のタグを削除 (Backspace対応)
   */
  function removeLastTag() {
    if (tags.length === 0) return;
    tags.pop();
    renderChips();
    updatePreview();
  }

  /**
   * すべてのタグを削除
   */
  function clearAllTags() {
    if (tags.length === 0) return;
    tags = [];
    renderChips();
    updatePreview();
    showToast('タグを全削除しました');
    if (tagInputField) {
      tagInputField.focus();
    }
  }

  /**
   * タグチップを描画する
   */
  function renderChips() {
    if (!tagChipsList) return;
    tagChipsList.innerHTML = '';

    tags.forEach(tag => {
      const chip = document.createElement('div');
      chip.className = `tag-chip${tag.isSnippet ? ' is-snippet' : ''}`;
      chip.setAttribute('data-id', tag.id);
      chip.setAttribute('role', 'listitem');

      const textSpan = document.createElement('span');
      textSpan.className = 'tag-chip-text';
      textSpan.textContent = tag.text;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'tag-chip-remove';
      removeBtn.setAttribute('aria-label', `タグ「${tag.text}」を削除`);
      removeBtn.setAttribute('tabindex', '-1');
      removeBtn.innerHTML = `
        <svg viewBox="0 0 14 14" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
          <path d="M2 2l10 10M12 2L2 12"></path>
        </svg>
      `;

      chip.appendChild(textSpan);
      const jp = window.WBTranslations ? window.WBTranslations.get(tag.text) : null;
      if (jp) {
        const jpSpan = document.createElement('span');
        jpSpan.className = 'tag-chip-jp';
        jpSpan.textContent = jp;
        chip.appendChild(jpSpan);
      }
      chip.appendChild(removeBtn);
      tagChipsList.appendChild(chip);
    });
  }

  /**
   * カンマ区切りのプレビューと各種状態バッジを更新
   */
  function updatePreview() {
    const count = tags.length;

    if (tagCounterBadge) {
      tagCounterBadge.textContent = `${count} 件`;
    }
    if (clearAllTagsBtn) {
      clearAllTagsBtn.disabled = count === 0;
    }
    if (copyPromptBtn) {
      copyPromptBtn.disabled = count === 0;
    }

    if (promptPreviewText) {
      if (count === 0) {
        promptPreviewText.innerHTML = '<span class="preview-empty-placeholder">タグを追加すると、ここにカンマ区切りのプロンプトが表示されます。</span>';
      } else {
        const joined = tags.map(t => t.text).join(', ');
        promptPreviewText.textContent = joined;
      }
    }
  }

  /**
   * 仮補完データからの検索 (T2)
   * @param {string} query
   * @returns {Array}
   */
  function searchDummySuggestions(query) {
    const q = (query || '').toLowerCase().trim();
    if (!q) return [];

    const results = [];
    for (const item of DUMMY_TAG_SUGGESTIONS) {
      const nameLower = item.name.toLowerCase();
      const matchedAlias = (item.aliases || []).find(a => a.toLowerCase().includes(q));

      if (nameLower.includes(q) || matchedAlias) {
        let score = 0;
        if (nameLower === q) score = 100;
        else if (nameLower.startsWith(q)) score = 80;
        else if (matchedAlias && matchedAlias.toLowerCase().startsWith(q)) score = 60;
        else score = 40;

        results.push({
          ...item,
          score,
          matchedAlias: matchedAlias || null
        });
      }
    }

    // スコア降順、同スコアなら使用頻度降順
    results.sort((a, b) => b.score - a.score || b.count - a.count);
    return results.slice(0, 8);
  }

  /**
   * 補完候補の取得 (カスタムプロバイダーまたはT2仮データ)
   * @param {string} query
   * @returns {Array|Promise<Array>}
   */
  function fetchSuggestions(query) {
    if (typeof customSuggestionsProvider === 'function') {
      return customSuggestionsProvider(query);
    }
    return searchDummySuggestions(query);
  }

  /**
   * 補完候補ドロップダウンを描画
   * @param {Array} suggestions
   * @param {string} query
   */
  function renderSuggestions(suggestions, query) {
    currentSuggestions = Array.isArray(suggestions) ? suggestions : [];
    activeSuggestionIndex = -1;

    if (!tagSuggestionsDropdown || !suggestionsList) return;

    if (currentSuggestions.length === 0) {
      const trimmedQuery = (query || '').trim();
      if (trimmedQuery) {
        suggestionsList.innerHTML = `
          <div class="suggestions-empty">
            候補なし（Enterで「${escapeHtml(trimmedQuery)}」を確定）
          </div>
        `;
        if (suggestionsCount) suggestionsCount.textContent = '0 件';
        openDropdown();
      } else {
        closeDropdown();
      }
      return;
    }

    if (suggestionsCount) {
      suggestionsCount.textContent = `${currentSuggestions.length} 件`;
    }

    suggestionsList.innerHTML = '';
    currentSuggestions.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'suggestion-item';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');
      row.setAttribute('data-index', String(index));

      const catNumber = typeof item.category === 'number' ? item.category : 0;
      const catClass = `cat-dot cat-dot-${catNumber}`;
      const catTitle = CATEGORY_NAMES[catNumber] || 'タグ';
      const countFormatted = formatCount(item.count);
      const jp = window.WBTranslations ? window.WBTranslations.get(item.name) : null;

      row.innerHTML = `
        <div class="suggestion-left">
          <span class="${catClass}" title="${catTitle}" aria-hidden="true"></span>
          <div class="suggestion-text-group">
            <span class="suggestion-name">${escapeHtml(item.name)}</span>
            ${item.matchedAlias ? `<span class="suggestion-alias">(${escapeHtml(item.matchedAlias)})</span>` : ''}
            ${jp ? `<span class="suggestion-jp">${escapeHtml(jp)}</span>` : ''}
          </div>
        </div>
        <span class="suggestion-count">${countFormatted}</span>
      `;

      // pointerdown で input の blur を防ぎ、確実に選択処理を実行
      row.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        selectSuggestion(item);
      });

      suggestionsList.appendChild(row);
    });

    openDropdown();
  }

  /**
   * キーボード選択中の候補を視覚的にハイライト
   */
  function highlightActiveSuggestion() {
    if (!suggestionsList) return;
    const items = suggestionsList.querySelectorAll('.suggestion-item');
    items.forEach((el, idx) => {
      const isActive = idx === activeSuggestionIndex;
      el.classList.toggle('active', isActive);
      el.setAttribute('aria-selected', isActive ? 'true' : 'false');
      if (isActive) {
        el.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  /**
   * 補完候補を選択してタグに追加
   * @param {Object} item
   */
  function selectSuggestion(item) {
    if (!item) return;
    addTag(item.name);
    if (tagInputField) {
      tagInputField.value = '';
      tagInputField.focus();
    }
    closeDropdown();
  }

  /**
   * 候補ドロップダウンを開く
   */
  function openDropdown() {
    if (!tagSuggestionsDropdown) return;
    tagSuggestionsDropdown.hidden = false;
    if (tagInputField) {
      tagInputField.setAttribute('aria-expanded', 'true');
    }
  }

  /**
   * 候補ドロップダウンを閉じる
   */
  function closeDropdown() {
    if (!tagSuggestionsDropdown) return;
    tagSuggestionsDropdown.hidden = true;
    currentSuggestions = [];
    activeSuggestionIndex = -1;
    if (tagInputField) {
      tagInputField.setAttribute('aria-expanded', 'false');
    }
  }

  // トースト通知タイマー
  let toastTimer = null;
  function showToast(message) {
    if (!copyToast) return;
    copyToast.textContent = message;
    copyToast.hidden = false;

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      copyToast.hidden = true;
    }, 2000);
  }

  // コピーボタン状態タイマー
  let copyStateTimer = null;

  /**
   * プロンプトをクリップボードにコピー
   */
  async function copyPromptToClipboard() {
    if (tags.length === 0) {
      showToast('コピーするタグがありません');
      return;
    }

    const promptString = tags.map(t => t.text).join(', ');
    let success = false;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(promptString);
        success = true;
      } else {
        // HTTP環境または古い環境向けフォールバック
        const ta = document.createElement('textarea');
        ta.value = promptString;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.top = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        success = document.execCommand('copy');
        document.body.removeChild(ta);
      }
    } catch (err) {
      console.warn('Clipboard copy error:', err);
      success = false;
    }

    if (success) {
      if (copyPromptBtn && copyPromptBtnText) {
        copyPromptBtn.classList.add('btn-copy-success');
        copyPromptBtnText.textContent = 'コピー完了!';

        if (copyStateTimer) clearTimeout(copyStateTimer);
        copyStateTimer = setTimeout(() => {
          copyPromptBtn.classList.remove('btn-copy-success');
          copyPromptBtnText.textContent = 'コピー';
        }, 1800);
      }
      showToast('クリップボードにコピーしました');
    } else {
      showToast('コピーに失敗しました');
    }
  }

  /* --------------------------------------------------------------------------
     イベントリスナー登録 (Tag input & プレビュー)
     -------------------------------------------------------------------------- */
  if (tagInputField) {
    let isComposing = false;

    tagInputField.addEventListener('compositionstart', () => {
      isComposing = true;
    });

    tagInputField.addEventListener('compositionend', (e) => {
      isComposing = false;
      // IME確定時にカンマが含まれている場合の処理
      handleInputText(e.target.value);
    });

    let searchReqSeq = 0;

    function handleInputText(val) {
      // カンマまたは読点が含まれている場合はタグ確定
      if (val.includes(',') || val.includes('、')) {
        const parts = val.split(/[,、]/);
        for (let i = 0; i < parts.length - 1; i++) {
          addTag(parts[i]);
        }
        const remaining = parts[parts.length - 1];
        tagInputField.value = remaining;
        if (!remaining.trim()) {
          closeDropdown();
          return;
        }
        val = remaining;
      }

      const q = val.trim();
      if (!q) {
        closeDropdown();
      } else {
        const currentReq = ++searchReqSeq;
        const res = fetchSuggestions(q);
        if (res instanceof Promise) {
          res.then(items => {
            if (currentReq === searchReqSeq) {
              renderSuggestions(items, q);
            }
          });
        } else {
          renderSuggestions(res, q);
        }
      }
    }

    tagInputField.addEventListener('input', (e) => {
      if (isComposing) return;
      handleInputText(e.target.value);
    });

    tagInputField.addEventListener('keydown', (e) => {
      if (isComposing || e.isComposing) return;

      if (e.key === 'ArrowDown') {
        if (!tagSuggestionsDropdown.hidden && currentSuggestions.length > 0) {
          e.preventDefault();
          activeSuggestionIndex = (activeSuggestionIndex + 1) % currentSuggestions.length;
          highlightActiveSuggestion();
        }
      } else if (e.key === 'ArrowUp') {
        if (!tagSuggestionsDropdown.hidden && currentSuggestions.length > 0) {
          e.preventDefault();
          if (activeSuggestionIndex <= 0) {
            activeSuggestionIndex = -1;
          } else {
            activeSuggestionIndex--;
          }
          highlightActiveSuggestion();
        }
      } else if (e.key === 'Enter') {
        if (isComposing) return;
        e.preventDefault();

        if (!tagSuggestionsDropdown.hidden && activeSuggestionIndex >= 0 && currentSuggestions[activeSuggestionIndex]) {
          selectSuggestion(currentSuggestions[activeSuggestionIndex]);
        } else if (tagInputField.value.trim()) {
          addTag(tagInputField.value);
          tagInputField.value = '';
          closeDropdown();
        }
      } else if (e.key === 'Backspace') {
        // 入力欄が空のときに末尾チップを削除 (SPEC 3.2 準拠)
        if (tagInputField.value === '' && tagInputField.selectionStart === 0 && tagInputField.selectionEnd === 0) {
          removeLastTag();
        }
      } else if (e.key === 'Escape') {
        if (!tagSuggestionsDropdown.hidden) {
          e.preventDefault();
          closeDropdown();
        }
      }
    });

    // カンマ区切りテキストの貼り付け対応
    tagInputField.addEventListener('paste', (e) => {
      const pasted = (e.clipboardData || window.clipboardData)?.getData('text');
      if (pasted && (pasted.includes(',') || pasted.includes('、') || pasted.includes('\n'))) {
        e.preventDefault();
        const parts = pasted.split(/[,、\n\r]+/);
        parts.forEach(part => addTag(part));
        tagInputField.value = '';
        closeDropdown();
      }
    });

    // 入力欄にフォーカスが入ったとき、文字があればドロップダウン再表示
    tagInputField.addEventListener('focus', () => {
      const q = tagInputField.value.trim();
      if (q) {
        const currentReq = ++searchReqSeq;
        const res = fetchSuggestions(q);
        if (res instanceof Promise) {
          res.then(items => {
            if (currentReq === searchReqSeq) {
              renderSuggestions(items, q);
            }
          });
        } else {
          renderSuggestions(res, q);
        }
      }
    });
  }

  // チップ削除ボタンクリック
  if (tagChipsList) {
    tagChipsList.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('.tag-chip-remove');
      if (removeBtn) {
        const chip = removeBtn.closest('.tag-chip');
        if (chip) {
          const tagId = chip.getAttribute('data-id');
          removeTag(tagId);
          if (tagInputField) {
            tagInputField.focus();
          }
        }
      }
    });
  }

  // 入力ボックスの余白タップでインプットへフォーカス
  if (tagInputBox) {
    tagInputBox.addEventListener('click', (e) => {
      if (!e.target.closest('.tag-chip') && tagInputField) {
        tagInputField.focus();
      }
    });
  }

  // コンテナ外タップで候補ドロップダウンを閉じる
  document.addEventListener('pointerdown', (e) => {
    if (tagInputContainer && !tagInputContainer.contains(e.target)) {
      closeDropdown();
    }
  });

  // 全削除ボタン
  if (clearAllTagsBtn) {
    clearAllTagsBtn.addEventListener('click', clearAllTags);
  }

  // コピーボタン
  if (copyPromptBtn) {
    copyPromptBtn.addEventListener('click', copyPromptToClipboard);
  }

  // T3 / T5 / T6 連携用 API 公開 (グローバル汚染を最小限に防ぐ Workbench 名前空間)
  window.PromptWorkbench = {
    getTags: () => tags.map(t => ({ ...t })),
    addTag: (text, isSnippet = false) => addTag(text, isSnippet),
    removeTag: (id) => removeTag(id),
    clearAllTags: () => clearAllTags(),
    showToast: (msg) => showToast(msg),
    setSuggestionsHeaderTitle: (title) => {
      const titleEl = document.getElementById('suggestionsHeaderTitle');
      if (titleEl) {
        titleEl.textContent = title;
      }
    },
    setSuggestionsProvider: (provider) => {
      customSuggestionsProvider = typeof provider === 'function' ? provider : null;
    }
  };

  // T11: 和訳データの読み込み完了後に、表示中のチップと候補へ和訳を反映する
  window.addEventListener('wb-translations-ready', () => {
    renderChips();
    if (tagSuggestionsDropdown && !tagSuggestionsDropdown.hidden && currentSuggestions.length > 0) {
      renderSuggestions(currentSuggestions, '');
    }
  });

  /* ==========================================================================
     セクション折りたたみ (T13)
     - .wb-collapse 配下の .wb-collapse-toggle で開閉する
     - 開閉状態は localStorage (prompt_workbench_collapse) に保存する
     ========================================================================== */
  const COLLAPSE_STORAGE_KEY = 'prompt_workbench_collapse';

  function initCollapses() {
    let state = {};
    try {
      state = JSON.parse(localStorage.getItem(COLLAPSE_STORAGE_KEY) || '{}') || {};
    } catch (e) {
      state = {};
    }
    document.querySelectorAll('.wb-collapse').forEach(sec => {
      const id = sec.getAttribute('data-collapse');
      const toggle = sec.querySelector('.wb-collapse-toggle');
      if (!id || !toggle) return;
      const apply = (collapsed) => {
        sec.classList.toggle('is-collapsed', collapsed);
        toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      };
      // 初期状態は折りたたみ。明示的に開いた場合（false 保存時）のみ展開で復元する
      apply(state[id] !== false);
      toggle.addEventListener('click', () => {
        const now = !sec.classList.contains('is-collapsed');
        apply(now);
        state[id] = now;
        try {
          localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(state));
        } catch (e) { /* 保存できなくても開閉は動作する */ }
      });
    });
  }

  function initHelpLinks() {
    document.querySelectorAll('[data-goto-help]').forEach(el => {
      el.addEventListener('click', () => {
        const helpTab = document.getElementById('tab-help');
        if (helpTab) helpTab.click();
      });
    });
  }

  /* ==========================================================================
     初期化実行
     ========================================================================== */
  function initApp() {
    applyInitialTab();
    updatePreview();
    initCollapses();
    initHelpLinks();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})();
