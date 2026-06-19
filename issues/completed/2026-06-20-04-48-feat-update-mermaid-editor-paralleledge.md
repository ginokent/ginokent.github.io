# Mermaid Editor を最新 (平行エッジ修正・#42〜#44 込み) へ再同期してデプロイする

- Priority: Medium
- Created: 2026-06-20 04:48 JST
- Completed: 2026-06-20 04:48 JST
- Model: Opus 4.8
- Branch: feature/update-mermaid-editor-paralleledge

## 目的

ginokent/mermaid-editor の最新 `main` (`918aae8`) を親サイトへ再同期し、`/tools/mermaid-editor`
(ja) / `/en/tools/mermaid-editor` (en) に反映してデプロイする。

## 取り込む変更 (前回反映済み fe5cf46 → 918aae8)

親サイト main の SOURCE は `fe5cf46` (#36) のままで、#42/#43 用の再同期ブランチ
(`feature/update-mermaid-editor-png`) は未マージだった。本同期は以下を一括で取り込む:

- ラベル無しエッジのダブルクリックで即ラベル編集、空確定で削除 (#42)
- flowchart の PNG 保存を foreignObject 無し再描画で直す (#43)
- 平行エッジ (同一 A→B 2 本) の 2 本目をクリックできない不具合を直す (#44)

→ 旧ブランチ `feature/update-mermaid-editor-png` は本同期に内包され不要 (削除可)。

## グルー手当て

- グルー元 (`index.html` / `src/main.ts` / `src/style.css`) に変化なし。`MermaidEditor.astro` の
  手当ては不要 (いずれも純ロジック変更)

## 実施内容

- `scripts/sync-mermaid-editor.sh ../mermaid-editor origin/main` でロジックを `918aae8` まで
  無改変同期 (correlate.ts / export.ts / render.ts / editor.ts / ui/inline.ts / ui/overlay.ts、
  SOURCE スタンプ更新)
- `pnpm run build` 緑 (322 ページ)

## デプロイ

`.github/workflows/deploy.yml` が `main` への push で自動実行 (GitHub Pages)。本ブランチを
PR 経由で `main` にマージすればデプロイされる。
