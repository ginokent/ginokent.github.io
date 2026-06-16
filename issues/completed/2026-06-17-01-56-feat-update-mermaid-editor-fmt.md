# Mermaid Editor を最新 (fmt 整形ボタン込み) へ再同期してデプロイする

- Priority: Medium
- Created: 2026-06-17 01:56 JST
- Completed: 2026-06-17 01:56 JST
- Model: Opus 4.8
- Branch: feature/update-mermaid-editor-fmt

## 目的

ginokent/mermaid-editor の最新 `main` (`fe5cf46`) を親サイトへ再同期し、`/tools/mermaid-editor`
(ja) / `/en/tools/mermaid-editor` (en) に反映してデプロイする。fmt (整形) ボタンを追加する。

## 取り込む変更 (前回同期 672f83e → fe5cf46)

- fmt (整形) ボタン: コピペした任意の mermaid を「宣言を上にまとめる」正準レイアウトへ整形 (#40)
- fmt の subgraph ラベル消失修正・整形順 (宣言→subgraph→エッジ)・セクション間の空行区切り (#41)

## グルー手当て (必須)

- 上流 `index.html` に `#fmt` ボタン、`src/main.ts` にハンドラが追加されたため、
  `src/components/MermaidEditor.astro` に手当てした:
  - ツールバーへ `<button id="fmt" title={m.fmtTitle}>{m.fmt}</button>` を追加 (add-element の隣)
  - `<script>` に `$('fmt').addEventListener('click', () => void editor.format())` を追加
  - 文言 `m.fmt` / `m.fmtTitle` は同期済み i18n (chrome.fmt/fmtTitle) から供給される
- `src/style.css` に変化は無く、CSS の手当ては不要

## 実施内容

- `scripts/sync-mermaid-editor.sh ../mermaid-editor origin/main` でロジックを `fe5cf46` まで
  無改変同期 (新規 `core/format.ts`、`editor.ts` の format()、`i18n` の chrome.fmt、SOURCE スタンプ更新)
- `pnpm run build` 緑 (322 ページ)

## デプロイ

`.github/workflows/deploy.yml` が `main` への push で自動実行 (GitHub Pages)。本ブランチを
PR 経由で `main` にマージすればデプロイされる。
