/**
 * プロンプト作業台 (Prompt Workbench)
 * T15: 分類エディタ（管理画面）
 *
 * - 大分類 → 中分類フォルダ → グループをカードで表示し、ドラッグ（≡ハンドル）
 *   と ↑↓ ボタンで並べ替える
 * - グループカードを別の大分類・中分類へドラッグすると所属が変わる
 * - 中分類フォルダの追加・名前変更・削除（削除時はグループが直下へ戻る）
 * - 編集結果は store の taxonomy（端末内）に保存され、スロット選択へ即反映
 * - 名前変更・大分類の新設・グループの削除は扱わない（ユーザー決定の範囲）
 */

(function () {
  'use strict';

  // model: [{ name, folders: [{ id, name, groups: [{id}] }], direct: [{id}] }]
  let model = null;

  function groupsApi() { return window.PromptWorkbenchGroups; }
  function store() { return window.PromptWorkbench && window.PromptWorkbench.store; }
  function toast(msg) {
    if (window.PromptWorkbench && typeof window.PromptWorkbench.showToast === 'function') {
      window.PromptWorkbench.showToast(msg);
    }
  }

  function groupInfo(id) {
    const api = groupsApi();
    const list = api && typeof api.getGroups === 'function' ? api.getGroups() : [];
    return list.find(x => x.id === id) || { id, name: id, tagCount: 0 };
  }

  function loadModel() {
    const api = groupsApi();
    if (!api || typeof api.getTaxonomyTree !== 'function') return null;
    return api.getTaxonomyTree().map(cat => ({
      name: cat.name,
      folders: (cat.folders || []).map(f => ({
        id: f.id,
        name: f.name,
        groups: f.groups.map(g => ({ id: g.id }))
      })),
      direct: (cat.direct || []).map(g => ({ id: g.id }))
    }));
  }

  // モデル全体を taxonomy 形式へ（自己完結させるため全量を書き出す）
  function serialize(m) {
    const tax = { catOrder: [], groupCat: {}, folders: [], folderOrder: {}, groupFolder: {}, order: {} };
    for (const cat of m) {
      tax.catOrder.push(cat.name);
      tax.folderOrder[cat.name] = cat.folders.map(f => f.id);
      tax.order[`cat:${cat.name}`] = cat.direct.map(g => g.id);
      for (const g of cat.direct) tax.groupCat[g.id] = cat.name;
      for (const f of cat.folders) {
        tax.folders.push({ id: f.id, cat: cat.name, name: f.name });
        tax.order[`folder:${f.id}`] = f.groups.map(g => g.id);
        for (const g of f.groups) {
          tax.groupCat[g.id] = cat.name;
          tax.groupFolder[g.id] = f.id;
        }
      }
    }
    return tax;
  }

  function commit() {
    const st = store();
    if (st && typeof st.saveTaxonomy === 'function') st.saveTaxonomy(serialize(model));
    render();
  }

  /* ---------------- 検索ヘルパー ---------------- */

  function findGroup(gid) {
    for (let ci = 0; ci < model.length; ci++) {
      const cat = model[ci];
      for (let fi = 0; fi < cat.folders.length; fi++) {
        const idx = cat.folders[fi].groups.findIndex(g => g.id === gid);
        if (idx >= 0) return { catIdx: ci, folderIdx: fi, idx, container: cat.folders[fi].groups };
      }
      const idx = cat.direct.findIndex(g => g.id === gid);
      if (idx >= 0) return { catIdx: ci, folderIdx: -1, idx, container: cat.direct };
    }
    return null;
  }

  function findFolder(fid) {
    for (let ci = 0; ci < model.length; ci++) {
      const fi = model[ci].folders.findIndex(f => f.id === fid);
      if (fi >= 0) return { catIdx: ci, folderIdx: fi, folder: model[ci].folders[fi] };
    }
    return null;
  }

  function containerByKey(key) {
    if (!key) return null;
    if (key.startsWith('folder:')) {
      const loc = findFolder(key.slice(7));
      return loc ? loc.folder.groups : null;
    }
    if (key.startsWith('cat:')) {
      const cat = model.find(c => c.name === key.slice(4));
      return cat ? cat.direct : null;
    }
    return null;
  }

  /* ---------------- 描画 ---------------- */

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function handleBtn(label) {
    const b = el('button', 'tax-handle', '≡');
    b.type = 'button';
    b.setAttribute('data-handle', '');
    b.setAttribute('aria-label', label || 'ドラッグで並べ替え');
    return b;
  }

  function actBtn(act, text, label) {
    const b = el('button', 'tax-mini-btn', text);
    b.type = 'button';
    b.setAttribute('data-act', act);
    if (label) b.setAttribute('aria-label', label);
    return b;
  }

  function buildCard(gid) {
    const info = groupInfo(gid);
    const card = el('div', 'tax-card');
    card.setAttribute('data-drag-item', 'group');
    card.setAttribute('data-gid', gid);
    card.appendChild(handleBtn(`グループ ${info.name} をドラッグで移動`));
    const name = el('span', 'tax-card-name', info.name);
    name.title = info.name;
    card.appendChild(name);
    card.appendChild(el('span', 'tax-count', `${info.tagCount}件`));
    card.appendChild(actBtn('group-up', '↑', '上へ'));
    card.appendChild(actBtn('group-down', '↓', '下へ'));
    return card;
  }

  function buildFolder(cat, folder) {
    const wrap = el('div', 'tax-folder');
    wrap.setAttribute('data-drag-item', 'folder');
    wrap.setAttribute('data-folder', folder.id);
    const head = el('div', 'tax-folder-head');
    head.appendChild(handleBtn(`中分類 ${folder.name} をドラッグで並べ替え`));
    head.appendChild(el('span', 'tax-folder-name', folder.name));
    head.appendChild(el('span', 'tax-count', `${folder.groups.length}`));
    head.appendChild(actBtn('folder-up', '↑', '中分類を上へ'));
    head.appendChild(actBtn('folder-down', '↓', '中分類を下へ'));
    head.appendChild(actBtn('folder-rename', '名前変更'));
    head.appendChild(actBtn('folder-del', '削除'));
    wrap.appendChild(head);
    const cards = el('div', 'tax-cards');
    cards.setAttribute('data-container', `folder:${folder.id}`);
    for (const g of folder.groups) cards.appendChild(buildCard(g.id));
    if (!folder.groups.length) cards.appendChild(el('div', 'tax-empty', '（グループなし）'));
    wrap.appendChild(cards);
    return wrap;
  }

  function buildCategory(cat) {
    const wrap = el('div', 'tax-cat');
    wrap.setAttribute('data-drag-item', 'cat');
    wrap.setAttribute('data-cat', cat.name);
    let count = cat.direct.length;
    for (const f of cat.folders) count += f.groups.length;

    const head = el('div', 'tax-cat-head');
    head.appendChild(handleBtn(`大分類 ${cat.name} をドラッグで並べ替え`));
    head.appendChild(el('span', 'tax-cat-name', cat.name));
    head.appendChild(el('span', 'tax-count', `${count}`));
    head.appendChild(actBtn('cat-up', '↑', '大分類を上へ'));
    head.appendChild(actBtn('cat-down', '↓', '大分類を下へ'));
    wrap.appendChild(head);

    const containers = el('div', 'tax-containers');
    for (const f of cat.folders) containers.appendChild(buildFolder(cat, f));
    const direct = el('div', 'tax-direct');
    direct.appendChild(el('div', 'tax-direct-head', '（中分類なし）'));
    const cards = el('div', 'tax-cards');
    cards.setAttribute('data-container', `cat:${cat.name}`);
    for (const g of cat.direct) cards.appendChild(buildCard(g.id));
    if (!cat.direct.length) cards.appendChild(el('div', 'tax-empty', '（グループなし）'));
    direct.appendChild(cards);
    containers.appendChild(direct);
    wrap.appendChild(containers);

    const addBtn = actBtn('folder-add', '＋ 中分類を追加');
    addBtn.className = 'tax-add-btn';
    wrap.appendChild(addBtn);
    return wrap;
  }

  function render() {
    const root = document.getElementById('taxonomyRoot');
    if (!root) return;
    root.innerHTML = '';
    const card = el('div', 'tax-editor-card');
    const head = el('div', 'tax-editor-head');
    head.appendChild(el('h3', 'tax-editor-title', '分類エディタ（タググループ）'));
    const resetBtn = actBtn('tax-reset', '初期状態に戻す');
    resetBtn.className = 'tax-reset-btn';
    head.appendChild(resetBtn);
    card.appendChild(head);
    card.appendChild(el('p', 'tax-note',
      'カードは ≡ をドラッグ、または ↑↓ で並べ替えできます。グループを別の大分類・中分類へドラッグすると所属が変わります。変更は端末内に保存され、生成画面のスロット選択に反映されます。'));
    if (!model) {
      card.appendChild(el('p', 'tax-note', 'グループ分類を読み込み中です…'));
    } else {
      const list = el('div', 'tax-list');
      for (const cat of model) list.appendChild(buildCategory(cat));
      card.appendChild(list);
    }
    root.appendChild(card);
  }

  /* ---------------- ボタン操作 ---------------- */

  function swap(arr, i, j) {
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }

  function onClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn || !model) return;
    const act = btn.getAttribute('data-act');

    if (act === 'tax-reset') {
      if (!window.confirm('分類の並び・所属・中分類を初期状態に戻しますか？')) return;
      const st = store();
      if (st && typeof st.resetTaxonomy === 'function') st.resetTaxonomy();
      model = loadModel();
      render();
      toast('分類を初期状態に戻しました');
      return;
    }

    const catEl = btn.closest('[data-cat]');
    const catName = catEl ? catEl.getAttribute('data-cat') : null;
    const catIdx = catName != null ? model.findIndex(c => c.name === catName) : -1;

    if (act === 'cat-up' || act === 'cat-down') {
      const j = catIdx + (act === 'cat-up' ? -1 : 1);
      if (catIdx < 0 || j < 0 || j >= model.length) return;
      swap(model, catIdx, j);
      commit();
      return;
    }

    if (act === 'folder-add') {
      if (catIdx < 0) return;
      const name = window.prompt('中分類の名前を入力してください');
      if (!name || !name.trim()) return;
      const id = 'folder_' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
      model[catIdx].folders.push({ id, name: name.trim(), groups: [] });
      commit();
      toast(`中分類「${name.trim()}」を追加しました`);
      return;
    }

    const folderEl = btn.closest('[data-folder]');
    const fid = folderEl ? folderEl.getAttribute('data-folder') : null;

    if (act === 'folder-up' || act === 'folder-down') {
      const loc = fid ? findFolder(fid) : null;
      if (!loc) return;
      const arr = model[loc.catIdx].folders;
      const j = loc.folderIdx + (act === 'folder-up' ? -1 : 1);
      if (j < 0 || j >= arr.length) return;
      swap(arr, loc.folderIdx, j);
      commit();
      return;
    }
    if (act === 'folder-rename') {
      const loc = fid ? findFolder(fid) : null;
      if (!loc) return;
      const name = window.prompt('中分類の名前', loc.folder.name);
      if (!name || !name.trim() || name.trim() === loc.folder.name) return;
      loc.folder.name = name.trim();
      commit();
      return;
    }
    if (act === 'folder-del') {
      const loc = fid ? findFolder(fid) : null;
      if (!loc) return;
      if (!window.confirm(`中分類「${loc.folder.name}」を削除しますか？中のグループは「（中分類なし）」へ移動します`)) return;
      const cat = model[loc.catIdx];
      cat.direct.push(...loc.folder.groups);
      cat.folders.splice(loc.folderIdx, 1);
      commit();
      toast('中分類を削除しました');
      return;
    }

    if (act === 'group-up' || act === 'group-down') {
      const cardEl = btn.closest('[data-gid]');
      const gid = cardEl ? cardEl.getAttribute('data-gid') : null;
      const loc = gid ? findGroup(gid) : null;
      if (!loc) return;
      const j = loc.idx + (act === 'group-up' ? -1 : 1);
      if (j < 0 || j >= loc.container.length) return;
      swap(loc.container, loc.idx, j);
      commit();
      return;
    }
  }

  /* ---------------- ドラッグ ---------------- */

  let drag = null;

  function candidateLists(type) {
    const root = document.getElementById('taxonomyRoot');
    if (!root) return [];
    if (type === 'group') return [...root.querySelectorAll('.tax-cards')];
    if (type === 'cat') return [...root.querySelectorAll('.tax-list')];
    if (type === 'folder') return [...root.querySelectorAll('.tax-containers')];
    return [];
  }

  function insertPlaceholder(listEl, y) {
    const ph = drag.placeholder;
    const siblings = [...listEl.children].filter(
      n => n.getAttribute && n.getAttribute('data-drag-item') === drag.type);
    let before = null;
    for (const sib of siblings) {
      if (sib === drag.item) continue;
      const r = sib.getBoundingClientRect();
      if (y < r.top + r.height / 2) { before = sib; break; }
    }
    if (before) {
      listEl.insertBefore(ph, before);
    } else if (drag.type === 'folder') {
      // フォルダは「（中分類なし）」ブロックより前に置く
      const direct = listEl.querySelector('.tax-direct');
      if (direct) listEl.insertBefore(ph, direct);
      else listEl.appendChild(ph);
    } else {
      listEl.appendChild(ph);
    }
  }

  function onPointerDown(e) {
    if (!model) return;
    const handle = e.target.closest('[data-handle]');
    if (!handle) return;
    const item = handle.closest('[data-drag-item]');
    if (!item) return;
    e.preventDefault();
    drag = {
      type: item.getAttribute('data-drag-item'),
      item,
      startY: e.clientY,
      active: false,
      placeholder: null,
      grabDY: 0
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
    window.addEventListener('pointercancel', onPointerUp, { once: true });
  }

  function onPointerMove(e) {
    if (!drag) return;
    const y = e.clientY;
    if (!drag.active) {
      if (Math.abs(y - drag.startY) < 6) return;
      const item = drag.item;
      const rect = item.getBoundingClientRect();
      drag.grabDY = drag.startY - rect.top;
      const ph = document.createElement('div');
      ph.className = 'tax-placeholder';
      ph.style.height = rect.height + 'px';
      item.parentNode.insertBefore(ph, item);
      item.classList.add('tax-dragging');
      item.style.width = rect.width + 'px';
      item.style.left = rect.left + 'px';
      item.style.top = rect.top + 'px';
      drag.placeholder = ph;
      drag.active = true;
    }
    drag.item.style.top = (y - drag.grabDY) + 'px';
    if (y < 90) window.scrollBy(0, -16);
    else if (y > window.innerHeight - 90) window.scrollBy(0, 16);
    for (const listEl of candidateLists(drag.type)) {
      const r = listEl.getBoundingClientRect();
      if (y >= r.top - 28 && y <= r.bottom + 28) {
        insertPlaceholder(listEl, y);
        break;
      }
    }
  }

  function onPointerUp() {
    window.removeEventListener('pointermove', onPointerMove);
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.active) return;

    const ph = d.placeholder;
    const listEl = ph.parentNode;
    // ドラッグ中の要素自身は DOM 上の元の位置に残っているため数えない
    const siblingsBefore = [...listEl.children]
      .slice(0, [...listEl.children].indexOf(ph))
      .filter(n => n !== d.item && n.getAttribute && n.getAttribute('data-drag-item') === d.type);
    const targetIndex = siblingsBefore.length;

    d.item.classList.remove('tax-dragging');
    d.item.style.width = '';
    d.item.style.left = '';
    d.item.style.top = '';
    ph.remove();

    if (d.type === 'group') {
      const gid = d.item.getAttribute('data-gid');
      const target = containerByKey(listEl.getAttribute('data-container'));
      const loc = findGroup(gid);
      if (!target || !loc) { render(); return; }
      loc.container.splice(loc.idx, 1);
      target.splice(Math.min(targetIndex, target.length), 0, { id: gid });
      commit();
      return;
    }
    if (d.type === 'cat') {
      const name = d.item.getAttribute('data-cat');
      const idx = model.findIndex(c => c.name === name);
      if (idx < 0) { render(); return; }
      const [cat] = model.splice(idx, 1);
      model.splice(Math.min(targetIndex, model.length), 0, cat);
      commit();
      return;
    }
    if (d.type === 'folder') {
      const fid = d.item.getAttribute('data-folder');
      const loc = findFolder(fid);
      const catEl = listEl.closest('[data-cat]');
      const newCatIdx = catEl ? model.findIndex(c => c.name === catEl.getAttribute('data-cat')) : -1;
      if (!loc || newCatIdx < 0) { render(); return; }
      const [folder] = model[loc.catIdx].folders.splice(loc.folderIdx, 1);
      const dest = model[newCatIdx].folders;
      dest.splice(Math.min(targetIndex, dest.length), 0, folder);
      commit();
      return;
    }
    render();
  }

  /* ---------------- 初期化 ---------------- */

  function initTaxonomyEditor() {
    const root = document.getElementById('taxonomyRoot');
    if (!root) return;
    render();
    root.addEventListener('click', onClick);
    root.addEventListener('pointerdown', onPointerDown);
    const timer = setInterval(() => {
      const api = groupsApi();
      const st = api && typeof api.getStatus === 'function' ? api.getStatus() : null;
      if (st && st.status === 'ready') {
        clearInterval(timer);
        model = loadModel();
        render();
      } else if (st && st.status === 'error') {
        clearInterval(timer);
        model = [];
        render();
      }
    }, 800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTaxonomyEditor);
  } else {
    initTaxonomyEditor();
  }
})();
