# Mermaid Editor を最新 (#42〜#45 込み) へ再同期してデプロイする

- Priority: Medium
- Created: 2026-06-29 16:19 JST
- Completed: 2026-06-29 16:19 JST
- Model: Opus 4.8
- Branch: feature/update-mermaid-editor-pickhint

## 目的

ginokent/mermaid-editor の最新 `main` (`e7bfc7f`) を親サイトへ再同期し、`/tools/mermaid-editor`
(ja) / `/en/tools/mermaid-editor` (en) に反映してデプロイする。

## 取り込む変更 (前回反映済み fe5cf46 → e7bfc7f)

親サイト main の SOURCE は `fe5cf46` (#36) のままで、#42〜#44 用の再同期ブランチ
(`feature/update-mermaid-editor-paralleledge`) も未マージだった。本同期は以下を一括で取り込む:

- ラベル無しエッジのダブルクリックで即ラベル編集、空確定で削除 (#42)
- flowchart の PNG 保存を foreignObject 無し再描画で直す (#43)
- 平行エッジ (同一 A→B 2 本) の 2 本目をクリックできない不具合を直す (#44)
- 選択モードのヒントをビューポート固定にして縦長図での見切れを防ぐ (#45)

→ 旧ブランチ `feature/update-mermaid-editor-paralleledge` は本同期に内包され不要 (削除可)。

## グルー手当て

- 上流 `src/style.css` の `.pick-hint` が `position: fixed` 化 (#45) されたため、
  `src/components/MermaidEditor.astro` の `<style>` の `.mermaid-editor .pick-hint` も同様に
  `position: fixed; top: 12px; z-index: 40` + 影へ手当てした
- `index.html` / `src/main.ts` に変化なし (他の手当ては不要)

## 実施内容

- `scripts/sync-mermaid-editor.sh ../mermaid-editor origin/main` でロジックを `e7bfc7f` まで
  無改変同期 (correlate / export / render / editor / ui/inline / ui/overlay、SOURCE スタンプ更新)
- `pnpm run build` 緑 (322 ページ)

## デプロイ

`.github/workflows/deploy.yml` が `main` への push で自動実行 (GitHub Pages)。本ブランチを
PR 経由で `main` にマージすればデプロイされる。
