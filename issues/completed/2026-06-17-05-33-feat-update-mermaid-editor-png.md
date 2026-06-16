# Mermaid Editor を最新 (エッジラベル dblclick・PNG 修正込み) へ再同期してデプロイする

- Priority: Medium
- Created: 2026-06-17 05:33 JST
- Completed: 2026-06-17 05:33 JST
- Model: Opus 4.8
- Branch: feature/update-mermaid-editor-png

## 目的

ginokent/mermaid-editor の最新 `main` (`11bc8cc`) を親サイトへ再同期し、`/tools/mermaid-editor`
(ja) / `/en/tools/mermaid-editor` (en) に反映してデプロイする。

## 取り込む変更 (前回同期 fe5cf46 → 11bc8cc)

- ラベル無しエッジのダブルクリックで即ラベル編集、空確定で削除 (#42)
- flowchart の PNG 保存を foreignObject 無し再描画で直す (#43)

## グルー手当て

- グルー元 (`index.html` / `src/main.ts` / `src/style.css`) に変化なし。`MermaidEditor.astro` の
  手当ては不要 (ツールバー・DOM・CSS の新規追加なし。いずれも純ロジック変更)

## 実施内容

- `scripts/sync-mermaid-editor.sh ../mermaid-editor origin/main` でロジックを `11bc8cc` まで
  無改変同期 (export.ts / render.ts / editor.ts / ui/inline.ts / ui/overlay.ts、SOURCE スタンプ更新)
- `pnpm run build` 緑 (322 ページ)

## デプロイ

`.github/workflows/deploy.yml` が `main` への push で自動実行 (GitHub Pages)。本ブランチを
PR 経由で `main` にマージすればデプロイされる。
