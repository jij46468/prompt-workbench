# プロンプト作業台（Prompt Workbench）

画像生成向けプロンプト作成のための、スマートフォン向け静的 Web アプリ。
タグ入力補完（Danbooru 辞書全件）と、テンプレート／ランダム生成を 1 つにまとめる。

- 仕様：SPEC.md
- 作業分割：TASKS.md
- 製作方式：Google Antigravity CLI（Gemini エージェント）が仕様に従って実装し、
  GitHub を受け渡し場所にする。画面部品は DesignBookmark /motion から
  Tag input／Expand card／Tab pill の 3 部品を採用。
- データは端末の localStorage のみに保存され、外部送信はしない。
- 和訳データ（data/translations-jp.csv）の出典：Civitai「Danbooru tag
  complete csv」（v2.0 の danbooru_translations_jp_anima29.csv を加工し、
  v1 分で一部補完）。自動翻訳由来のため訳は目安。
