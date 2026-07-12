# Mermaid Editor を最新 (ヒント位置=画面∩SVG 中央上部) へ再同期してデプロイする

- Priority: Medium
- Created: 2026-07-13 08:05 JST
- Completed: 2026-07-13 08:05 JST
- Model: Opus 4.7
- Branch: feature/update-mermaid-editor-pickhint-intersection

## 目的

ginokent/mermaid-editor の最新 `main` (`5e74e49`) を親サイトへ再同期し、`/tools/mermaid-editor`
(ja) / `/en/tools/mermaid-editor` (en) に反映してデプロイする。

## 取り込む変更 (前回同期 e7bfc7f → 5e74e49)

- 選択モードのヒント位置を「画面ビューポート ∩ SVG 描画領域」の中央上部に配置 (mermaid-editor #47)
  - 縦: max(viewport 上端, svg 上端) + 8px、横: 共通部分の水平中央
  - スクロール / リサイズにライブ追従。モード終了で必ずリスナ解除
  - 過去実装: #45 (画面上端=ヘッダ被り) → #46 (画面下端=図から視線が離れる) → 本 PR

## グルー手当て

- 上流 `src/style.css` の `.pick-hint` から位置固定 (`bottom: 16px; left: 50%`) が外れ、
  `transform: translateX(-50%)` のみ残る変更に合わせ、`src/components/MermaidEditor.astro` の
  `<style>` の `.mermaid-editor .pick-hint` も同様に更新
- 位置は同期された `overlay.ts` の `positionHint` がインラインで設定する
- `index.html` / `src/main.ts` に変化なし (他の手当ては不要)

## 実施内容

- `scripts/sync-mermaid-editor.sh ../mermaid-editor origin/main` でロジックを `5e74e49` まで
  無改変同期 (overlay.ts の positionHint 追加を含む、SOURCE スタンプ更新)
- `pnpm run build` 緑 (322 ページ)

## デプロイ

`.github/workflows/deploy.yml` が `main` への push で自動実行 (GitHub Pages)。本ブランチを
PR 経由で `main` にマージすればデプロイされる。
