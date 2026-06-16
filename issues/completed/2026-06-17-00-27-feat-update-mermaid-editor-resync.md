# Mermaid Editor を最新 (subgraph 対応込み) へ再同期してデプロイする

- Priority: Medium
- Created: 2026-06-17 00:27 JST
- Completed: 2026-06-17 00:27 JST
- Model: Opus 4.8
- Branch: feature/update-mermaid-editor

## 目的

ginokent/mermaid-editor の最新 `main` (`672f83e`) を親サイトへ再同期し、`/tools/mermaid-editor`
(ja) / `/en/tools/mermaid-editor` (en) に反映してデプロイする。

## 取り込む変更 (前回同期 1ab9e78 → 672f83e)

- 階層メニューのホバー展開・クリック固定 (カスケード式サブメニュー、#36)
- flowchart ラベルの特殊文字 (() 等) を引用符で囲んで書き戻す (#37)
- flowchart 追加時にノード宣言を上・矢印を下に分けて挿入 (#38)
- flowchart の subgraph 対応 (ノード割り当て + タイトル編集、#39)

## グルー手当て

- 上流の `src/style.css` に `.menu-item.is-open` (サブメニュー親のハイライト) が追加されたため、
  `src/components/MermaidEditor.astro` の `<style is:global>` へ `.mermaid-editor .menu-item.is-open`
  を移植した。`index.html` / `src/main.ts` に変化は無く、その他の手当ては不要

## 実施内容

- `scripts/sync-mermaid-editor.sh ../mermaid-editor origin/main` でロジックを `672f83e` まで
  無改変同期 (新規 `core/source/subgraph.ts` を含む、SOURCE スタンプ更新)
- `pnpm run build` 緑 (322 ページ)

## デプロイ

`.github/workflows/deploy.yml` が `main` への push で自動実行 (GitHub Pages)。本ブランチを
PR 経由で `main` にマージすればデプロイされる。
