/**
 * プロンプト作業台 (Prompt Workbench)
 * T1: アプリ骨格 & Tab pill ナビゲーション
 */

(function () {
  'use strict';

  // DOM 要素の取得
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
      // リフローを強制して即座に反映させた後、アニメーションを復帰
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

    // 4. URLハッシュ更新（ブラウザのリロード・戻る対応）
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

  // イベントリスナーの登録
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn, true, true);
    });

    btn.addEventListener('keydown', handleTabKeydown);
  });

  // 画面リサイズ・回転時にピル位置を正確に再計算（アニメーションなし）
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

  // ハッシュ変更時（ブラウザの進む・戻る）の対応
  window.addEventListener('hashchange', () => {
    applyInitialTab();
  });

  // 初期化実行
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyInitialTab);
  } else {
    applyInitialTab();
  }
})();
