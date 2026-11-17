/**
 * translations.js — タグ和訳データ (T11)
 *
 * data/translations-jp.csv（タグ,和訳 の2列、50,885件）を読み込み、
 * window.WBTranslations.get(tag) で引けるようにする。
 * 出典: Civitai「Danbooru tag complete csv」v2.0 の
 * danbooru_translations_jp_anima29.csv（先頭の日本語要素のみ抽出、
 * v1分で欠けを補完）。生成手順は tools/translations/build.py。
 *
 * 読み込み完了時に window へ 'wb-translations-ready' イベントを発火する。
 * 失敗してもアプリ本体は動作する（和訳が出ないだけ）。
 */
(function () {
  'use strict';

  const CSV_PATH = 'data/translations-jp.csv';
  const map = new Map();
  let ready = false;

  function parseLine(line) {
    // 簡易CSVパーサ（ダブルクォート対応）
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }

  function normalize(tag) {
    return String(tag || '').trim().toLowerCase().replace(/\s+/g, '_');
  }

  function get(tag) {
    if (!ready) return null;
    const key = normalize(tag);
    return map.get(key) || null;
  }

  /** プロンプト文字列（カンマ区切り）→ 訳があるタグだけを「、」で並べた文字列 */
  function translatePrompt(prompt) {
    if (!ready || !prompt) return '';
    const parts = [];
    String(prompt).split(',').forEach(token => {
      const jp = get(token);
      if (jp) parts.push(jp);
    });
    return parts.join('、');
  }

  window.WBTranslations = {
    get,
    translatePrompt,
    isReady: () => ready,
    size: () => map.size,
  };

  function updateManageStat() {
    const el = document.getElementById('dictStatTranslations');
    if (el) el.textContent = ready ? `${map.size.toLocaleString('ja-JP')} 件` : '読み込み失敗';
  }

  async function load() {
    try {
      const res = await fetch(CSV_PATH);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      text.split(/\r?\n/).forEach(line => {
        if (!line) return;
        const cols = parseLine(line);
        if (cols.length >= 2 && cols[0] && cols[1]) {
          map.set(normalize(cols[0]), cols[1].trim());
        }
      });
      ready = true;
    } catch (err) {
      console.warn('和訳データの読み込みに失敗しました:', err);
    }
    updateManageStat();
    window.dispatchEvent(new Event('wb-translations-ready'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
