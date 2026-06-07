# /tools/mermaid-editor/ の作業領域が狭く、ダークテーマで見出しが潰れる

- Priority: Medium
- Created: 2026-06-07 09:48 JST
- Completed:
- Model: Opus 4.8
- Branch: feature/fix-mermaid-editor-layout

## 目的

公開した `/tools/mermaid-editor/` の表示不具合を解消し、実用的な見た目にする。

## 経緯

デプロイ後の実機 (ダークテーマ) でユーザーから「横幅が狭すぎる」との指摘を受けた。スクリーンショットでは、地 (ページ背景) に乗る見出し・説明・ペイン見出しがダーク背景に対して暗く潰れている問題も併せて確認できた。

## 優先度根拠

公開済みツールの可読性・実用性に直結する表示不具合であり、影響は利用者全員に及ぶため Medium とする。

## 現状・問題

- `src/styles/global.css` の `.container { max-width: 720px }` (ブログ記事向けの幅) がツールページにもそのまま効き、テキスト・図を縦積みするエディタには窮屈
- 移植時に `.mermaid-editor { color: #1a1a1a }` を全体へ適用したため、ダークテーマで地に乗る見出し (`.me-header h1` / `.me-header p` / `.pane h2`) が暗背景に暗文字で潰れる。白背景ウィジェット内 (ボタン・テキストエリア・メニュー等) は個別に色指定済みのため問題ない

## 完了条件

- ツールページの作業領域がブログ既定の 720px より広く、図とテキストが見やすい
- ダークテーマでも見出し・説明・ペイン見出しが可読 (テーマ色に追従)
- 他ページ (記事・OCR 等) の幅・配色に影響しない

## 解決方法

- `mermaid-editor.astro` の `<style is:global>` に、`.mermaid-editor` を含む `main.container` のみ `max-width` を広げる指定を追加する (`:has()` で当該ページに限定)
- `.mermaid-editor` 全体への `color: #1a1a1a` を撤去し、地に乗る見出し・説明・ラベルはサイトのテーマ色変数 (`var(--text)` / `var(--text-secondary)`) に追従させる。白背景ウィジェット内の文字色は従来どおり個別固定を維持する

## 設計方針

- 既存の移植方針 (グルーは `.astro` 側で保守) を踏襲し、`src/scripts/mermaid-editor/` のロジックには触れない
- サイト全体への影響を避けるため、幅・配色の上書きは `.mermaid-editor` スコープと `:has()` に閉じ込める
