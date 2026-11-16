/**
 * プロンプト作業台 (Prompt Workbench)
 * T6: 管理画面（ワイルドカード／スニペット CRUD、データ入出力）
 *     ＋ 編集画面のスニペット挿入一覧
 *
 * - 保存先は localStorage のみ（store.js 経由）
 * - 画面は Expand card 形式（SPEC §2.3 / §3.3）
 * - 取り込みはファイル複数選択の追加式＋貼り付け（フォルダ選択は使わない）
 * - 外部通信なし
 */

(function () {
  'use strict';

  /* ==========================================================================
     純粋ロジック（入出力データの整形・検証・マージ）
     ========================================================================== */

  const EXPORT_APP_ID = 'prompt-workbench';
  const EXPORT_VERSION = 1;

  function buildExportObject(wildcards, snippets) {
    return {
      app: EXPORT_APP_ID,
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      wildcards: wildcards || {},
      snippets: Array.isArray(snippets) ? snippets : []
    };
  }

  /**
   * 取り込みJSONを検証し、正規化した { wildcards, snippets } を返す。
   * 形式が不正な場合は Error を投げる。
   */
  function parseImportData(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('JSONのルートがオブジェクトではありません');
    }

    const wildcards = {};
    if (data.wildcards !== undefined) {
      if (!data.wildcards || typeof data.wildcards !== 'object' || Array.isArray(data.wildcards)) {
        throw new Error('wildcards の形式が不正です');
      }
      for (const [name, items] of Object.entries(data.wildcards)) {
        if (!Array.isArray(items)) {
          throw new Error(`ワイルドカード「${name}」の項目が配列ではありません`);
        }
        wildcards[name] = items.map((x) => String(x).trim()).filter((x) => x.length > 0);
      }
    }

    const snippets = [];
    if (data.snippets !== undefined) {
      if (!Array.isArray(data.snippets)) {
        throw new Error('snippets の形式が不正です');
      }
      for (const s of data.snippets) {
        if (!s || typeof s !== 'object' || typeof s.name !== 'string' || typeof s.content !== 'string') {
          throw new Error('スニペットの形式が不正です（name と content が必要）');
        }
        snippets.push({
          id: typeof s.id === 'string' && s.id ? s.id : null,
          name: s.name,
          content: s.content
        });
      }
    }

    return { wildcards, snippets };
  }

  /**
   * スニペットのマージ：同名は上書き（idは既存を維持）、新規は追加。
   * @returns {Array} マージ後の配列
   */
  function mergeSnippets(existing, imported, idGen) {
    const result = (Array.isArray(existing) ? existing : []).map((s) => ({ ...s }));
    for (const imp of imported) {
      const idx = result.findIndex((s) => s.name === imp.name);
      if (idx >= 0) {
        result[idx] = { ...result[idx], content: imp.content };
      } else {
        result.push({ id: imp.id || idGen(), name: imp.name, content: imp.content });
      }
    }
    return result;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ==========================================================================
     UI
     ========================================================================== */

  const expandedIds = new Set();
  let pendingFiles = [];

  function toast(msg) {
    if (window.PromptWorkbench && typeof window.PromptWorkbench.showToast === 'function') {
      window.PromptWorkbench.showToast(msg);
    }
  }

  function store() {
    return window.PromptWorkbench ? window.PromptWorkbench.store : null;
  }

  function genSnippetId() {
    return 'snip_' + Date.now().toString(36) + Math.floor(Math.random() * 0xffff).toString(36);
  }

  /**
   * Expand card の骨格を作る（T5 と同じ構造・クラス）。
   * @returns {{card: HTMLElement, content: HTMLElement}}
   */
  function createExpandCard(key, titleHtml, metaText) {
    const card = document.createElement('div');
    card.className = 'manage-card expand-card';
    const isExpanded = expandedIds.has(key);
    if (isExpanded) card.classList.add('is-expanded');

    card.innerHTML = `
      <button type="button" class="expand-card-header" aria-expanded="${isExpanded ? 'true' : 'false'}">
        <span class="manage-card-title">${titleHtml}</span>
        ${metaText ? `<span class="manage-card-meta">${escapeHtml(metaText)}</span>` : ''}
        <svg class="expand-card-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>
      <div class="expand-card-body">
        <div class="expand-card-body-inner">
          <div class="expand-card-content manage-card-content"></div>
        </div>
      </div>
    `;

    const headerBtn = card.querySelector('.expand-card-header');
    headerBtn.addEventListener('click', () => {
      const now = card.classList.toggle('is-expanded');
      headerBtn.setAttribute('aria-expanded', now ? 'true' : 'false');
      if (now) expandedIds.add(key); else expandedIds.delete(key);
    });

    return { card, content: card.querySelector('.manage-card-content') };
  }

  /* ------------------------------------------------------------------------
     ワイルドカード管理
     ------------------------------------------------------------------------ */
  function renderWildcardManage() {
    const root = document.getElementById('wildcardManageRoot');
    const st = store();
    if (!root || !st) return;

    const wildcards = st.getWildcards();
    const names = Object.keys(wildcards).sort((a, b) => a.localeCompare(b, 'ja'));

    root.innerHTML = '';
    const heading = document.createElement('div');
    heading.className = 'manage-section-heading';
    heading.innerHTML = `<h3 class="manage-section-title">ワイルドカード管理</h3><span class="tag-counter">${names.length} 件</span>`;
    root.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'manage-card-list';
    root.appendChild(list);

    // 新規追加カード
    {
      const { card, content } = createExpandCard('wc-new', '＋ 新規ワイルドカード', '');
      content.innerHTML = `
        <label class="manage-field-label" for="wcNewName">名前（__名前__ で参照）</label>
        <input type="text" class="manage-input" id="wcNewName" placeholder="例: 小物" autocomplete="off">
        <label class="manage-field-label" for="wcNewItems">項目（1行に1項目）</label>
        <textarea class="manage-textarea" id="wcNewItems" rows="5" placeholder="1行に1項目ずつ入力"></textarea>
        <div class="manage-actions">
          <button type="button" class="btn-manage-primary" id="wcAddBtn">追加する</button>
        </div>
      `;
      content.querySelector('#wcAddBtn').addEventListener('click', () => {
        const name = content.querySelector('#wcNewName').value.trim();
        const items = content.querySelector('#wcNewItems').value
          .split('\n').map((s) => s.trim()).filter(Boolean);
        if (!name) { toast('名前を入力してください'); return; }
        if (items.length === 0) { toast('項目を1つ以上入力してください'); return; }
        if (st.getWildcard(name)) {
          if (!window.confirm(`ワイルドカード「${name}」は既にあります。上書きしますか？`)) return;
        }
        st.setWildcard(name, items);
        expandedIds.add('wc:' + name);
        toast(`ワイルドカード「${name}」を追加しました`);
        renderWildcardManage();
      });
      list.appendChild(card);
    }

    // 既存ワイルドカードのカード
    for (const name of names) {
      const items = Array.isArray(wildcards[name]) ? wildcards[name] : [];
      const { card, content } = createExpandCard(
        'wc:' + name,
        `__${escapeHtml(name)}__`,
        `${items.length} 項目`
      );
      const taId = 'wcItems_' + Math.random().toString(36).slice(2, 9);
      content.innerHTML = `
        <label class="manage-field-label" for="${taId}">項目（1行に1項目）</label>
        <textarea class="manage-textarea" id="${taId}" rows="6">${escapeHtml(items.join('\n'))}</textarea>
        <div class="manage-actions">
          <button type="button" class="btn-manage-primary" data-act="save">保存</button>
          <button type="button" class="btn-manage-danger" data-act="del">削除</button>
        </div>
      `;
      content.querySelector('[data-act="save"]').addEventListener('click', () => {
        const newItems = content.querySelector('textarea').value
          .split('\n').map((s) => s.trim()).filter(Boolean);
        if (newItems.length === 0) { toast('項目を1つ以上入力してください（削除は「削除」ボタンから）'); return; }
        st.setWildcard(name, newItems);
        toast(`「${name}」を保存しました（${newItems.length} 項目）`);
        renderWildcardManage();
      });
      content.querySelector('[data-act="del"]').addEventListener('click', () => {
        if (!window.confirm(`ワイルドカード「${name}」を削除しますか？`)) return;
        st.deleteWildcard(name);
        expandedIds.delete('wc:' + name);
        toast(`「${name}」を削除しました`);
        renderWildcardManage();
      });
      list.appendChild(card);
    }
  }

  /* ------------------------------------------------------------------------
     スニペット管理
     ------------------------------------------------------------------------ */
  function renderSnippetManage() {
    const root = document.getElementById('snippetManageRoot');
    const st = store();
    if (!root || !st) return;

    const snippets = st.getSnippets();

    root.innerHTML = '';
    const heading = document.createElement('div');
    heading.className = 'manage-section-heading';
    heading.innerHTML = `<h3 class="manage-section-title">スニペット管理</h3><span class="tag-counter">${snippets.length} 件</span>`;
    root.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'manage-card-list';
    root.appendChild(list);

    // 新規追加カード
    {
      const { card, content } = createExpandCard('snip-new', '＋ 新規スニペット', '');
      content.innerHTML = `
        <label class="manage-field-label">名前</label>
        <input type="text" class="manage-input" data-f="name" placeholder="例: 品質" autocomplete="off">
        <label class="manage-field-label">フレーズ</label>
        <textarea class="manage-textarea" data-f="content" rows="3" placeholder="例: masterpiece, best quality"></textarea>
        <div class="manage-actions">
          <button type="button" class="btn-manage-primary" data-act="add">追加する</button>
        </div>
      `;
      content.querySelector('[data-act="add"]').addEventListener('click', () => {
        const name = content.querySelector('[data-f="name"]').value.trim();
        const text = content.querySelector('[data-f="content"]').value.trim();
        if (!name) { toast('名前を入力してください'); return; }
        if (!text) { toast('フレーズを入力してください'); return; }
        const all = st.getSnippets();
        if (all.some((s) => s.name === name)) { toast(`スニペット「${name}」は既にあります`); return; }
        all.push({ id: genSnippetId(), name, content: text });
        st.saveSnippets(all);
        toast(`スニペット「${name}」を追加しました`);
        renderSnippetManage();
        renderSnippetList();
      });
      list.appendChild(card);
    }

    // 既存スニペットのカード
    for (const snip of snippets) {
      const { card, content } = createExpandCard(
        'snip:' + snip.id,
        escapeHtml(snip.name),
        ''
      );
      content.innerHTML = `
        <label class="manage-field-label">名前</label>
        <input type="text" class="manage-input" data-f="name" value="${escapeHtml(snip.name)}" autocomplete="off">
        <label class="manage-field-label">フレーズ</label>
        <textarea class="manage-textarea" data-f="content" rows="3">${escapeHtml(snip.content)}</textarea>
        <div class="manage-actions">
          <button type="button" class="btn-manage-primary" data-act="save">保存</button>
          <button type="button" class="btn-manage-danger" data-act="del">削除</button>
        </div>
      `;
      content.querySelector('[data-act="save"]').addEventListener('click', () => {
        const name = content.querySelector('[data-f="name"]').value.trim();
        const text = content.querySelector('[data-f="content"]').value.trim();
        if (!name) { toast('名前を入力してください'); return; }
        if (!text) { toast('フレーズを入力してください'); return; }
        const all = st.getSnippets();
        if (all.some((s) => s.name === name && s.id !== snip.id)) {
          toast(`スニペット「${name}」は既にあります`); return;
        }
        const idx = all.findIndex((s) => s.id === snip.id);
        if (idx >= 0) {
          all[idx] = { ...all[idx], name, content: text };
          st.saveSnippets(all);
          toast(`スニペット「${name}」を保存しました`);
          renderSnippetManage();
          renderSnippetList();
        }
      });
      content.querySelector('[data-act="del"]').addEventListener('click', () => {
        if (!window.confirm(`スニペット「${snip.name}」を削除しますか？`)) return;
        const all = st.getSnippets().filter((s) => s.id !== snip.id);
        st.saveSnippets(all);
        expandedIds.delete('snip:' + snip.id);
        toast(`「${snip.name}」を削除しました`);
        renderSnippetManage();
        renderSnippetList();
      });
      list.appendChild(card);
    }
  }

  /* ------------------------------------------------------------------------
     データ入出力（JSON）
     ------------------------------------------------------------------------ */
  function currentExportJson() {
    const st = store();
    if (!st) return '{}';
    return JSON.stringify(buildExportObject(st.getWildcards(), st.getSnippets()), null, 2);
  }

  function applyImport(data) {
    const st = store();
    if (!st) throw new Error('ストアが初期化されていません');
    const parsed = parseImportData(data);

    let wcCount = 0;
    for (const [name, items] of Object.entries(parsed.wildcards)) {
      st.setWildcard(name, items);
      wcCount++;
    }

    let snipCount = 0;
    if (parsed.snippets.length > 0) {
      const merged = mergeSnippets(st.getSnippets(), parsed.snippets, genSnippetId);
      snipCount = parsed.snippets.length;
      st.saveSnippets(merged);
    }

    return { wcCount, snipCount };
  }

  function renderDataIo() {
    const root = document.getElementById('dataIoRoot');
    const st = store();
    if (!root || !st) return;

    root.innerHTML = '';
    const heading = document.createElement('div');
    heading.className = 'manage-section-heading';
    heading.innerHTML = `<h3 class="manage-section-title">データ入出力（JSON）</h3>`;
    root.appendChild(heading);

    const { card, content } = createExpandCard('io', 'バックアップ / 復元', 'ワイルドカード＋スニペット');
    content.innerHTML = `
      <p class="manage-note">書き出し：現在のワイルドカードとスニペットを JSON で保存します。</p>
      <div class="manage-actions">
        <button type="button" class="btn-manage-primary" data-act="download">JSONをダウンロード</button>
        <button type="button" class="btn-manage-sub" data-act="copy">JSONをコピー</button>
      </div>
      <label class="manage-field-label">現在のデータ（JSON）</label>
      <textarea class="manage-textarea manage-json-view" data-f="exportView" rows="6" readonly></textarea>

      <p class="manage-note">取り込み：同名のワイルドカード／スニペットは上書き、それ以外は追加されます。</p>
      <label class="manage-field-label">ファイルから取り込む（複数選択可・追加式）</label>
      <input type="file" class="manage-file-input" data-f="file" accept=".json,application/json" multiple>
      <div class="manage-file-list" data-f="fileList"></div>
      <div class="manage-actions">
        <button type="button" class="btn-manage-primary" data-act="importFiles" disabled>選択したファイルを取り込む</button>
      </div>
      <label class="manage-field-label">貼り付けて取り込む</label>
      <textarea class="manage-textarea" data-f="paste" rows="5" placeholder="バックアップJSONをここに貼り付け"></textarea>
      <div class="manage-actions">
        <button type="button" class="btn-manage-primary" data-act="importPaste">貼り付けを取り込む</button>
      </div>
    `;
    // 書き出しビューの初期表示
    const exportView = content.querySelector('[data-f="exportView"]');
    if (exportView) exportView.value = currentExportJson();
    root.appendChild(card);

    const fileInput = content.querySelector('[data-f="file"]');
    const fileList = content.querySelector('[data-f="fileList"]');
    const importFilesBtn = content.querySelector('[data-act="importFiles"]');

    function renderPendingFiles() {
      fileList.innerHTML = '';
      pendingFiles.forEach((f, i) => {
        const row = document.createElement('div');
        row.className = 'manage-file-row';
        row.innerHTML = `<span class="manage-file-name">${escapeHtml(f.name)}</span>`;
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'btn-manage-sub btn-manage-small';
        rm.textContent = '外す';
        rm.addEventListener('click', () => {
          pendingFiles.splice(i, 1);
          renderPendingFiles();
        });
        row.appendChild(rm);
        fileList.appendChild(row);
      });
      importFilesBtn.disabled = pendingFiles.length === 0;
    }

    fileInput.addEventListener('change', () => {
      for (const f of fileInput.files) pendingFiles.push(f);
      fileInput.value = '';
      renderPendingFiles();
    });

    importFilesBtn.addEventListener('click', async () => {
      let okCount = 0;
      const errors = [];
      for (const f of [...pendingFiles]) {
        try {
          const text = await f.text();
          const r = applyImport(JSON.parse(text));
          okCount++;
          console.log(`imported ${f.name}:`, r);
        } catch (e) {
          errors.push(`${f.name}: ${e.message}`);
        }
      }
      pendingFiles = [];
      renderPendingFiles();
      refreshAll();
      if (okCount > 0) toast(`${okCount} 件のファイルを取り込みました`);
      if (errors.length > 0) toast(`取り込みエラー: ${errors[0]}`);
      if (okCount === 0 && errors.length === 0) toast('ファイルが選択されていません');
    });

    content.querySelector('[data-act="download"]').addEventListener('click', () => {
      const blob = new Blob([currentExportJson()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'prompt-workbench-backup.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('JSONをダウンロードしました');
    });

    content.querySelector('[data-act="copy"]').addEventListener('click', async () => {
      const text = currentExportJson();
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          const view = content.querySelector('[data-f="exportView"]');
          view.removeAttribute('readonly');
          view.select();
          document.execCommand('copy');
          view.setAttribute('readonly', '');
        }
        toast('JSONをコピーしました');
      } catch (e) {
        toast('コピーに失敗しました');
      }
    });

    content.querySelector('[data-act="importPaste"]').addEventListener('click', () => {
      const text = content.querySelector('[data-f="paste"]').value.trim();
      if (!text) { toast('JSONを貼り付けてください'); return; }
      try {
        const r = applyImport(JSON.parse(text));
        refreshAll();
        toast(`取り込みました（ワイルドカード ${r.wcCount} 件 / スニペット ${r.snipCount} 件）`);
      } catch (e) {
        toast(`取り込みエラー: ${e.message}`);
      }
    });
  }

  function refreshAll() {
    renderWildcardManage();
    renderSnippetManage();
    renderDataIo();
    renderSnippetList();
  }

  /* ------------------------------------------------------------------------
     編集画面：スニペット挿入一覧
     ------------------------------------------------------------------------ */
  function renderSnippetList() {
    const list = document.getElementById('snippetList');
    const empty = document.getElementById('snippetEmpty');
    const badge = document.getElementById('snippetCounterBadge');
    const st = store();
    if (!list || !st) return;

    const snippets = st.getSnippets();
    if (badge) badge.textContent = `${snippets.length} 件`;
    if (empty) empty.hidden = snippets.length > 0;

    list.innerHTML = '';
    for (const snip of snippets) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'snippet-chip-btn';
      btn.setAttribute('role', 'listitem');
      btn.innerHTML = `
        <span class="snippet-chip-name">${escapeHtml(snip.name)}</span>
        <span class="snippet-chip-content">${escapeHtml(snip.content)}</span>
      `;
      btn.addEventListener('click', () => {
        const wb = window.PromptWorkbench;
        if (wb && typeof wb.addTag === 'function') {
          wb.addTag(snip.content, true);
          toast(`スニペット「${snip.name}」を挿入しました`);
        }
      });
      list.appendChild(btn);
    }
  }

  /* ------------------------------------------------------------------------
     初期化
     ------------------------------------------------------------------------ */
  function initManage() {
    renderWildcardManage();
    renderSnippetManage();
    renderDataIo();
    renderSnippetList();
  }

  // API エクスポート（検証・連携用）
  window.PromptWorkbench = window.PromptWorkbench || {};
  window.PromptWorkbench.manage = {
    buildExportObject,
    parseImportData,
    mergeSnippets
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initManage);
    } else {
      initManage();
    }
  }
})();
