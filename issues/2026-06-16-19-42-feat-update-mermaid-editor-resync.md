# Mermaid Editor を最新 (ノート追加機能込み) へ再同期してデプロイする

- Priority: Medium
- Created: 2026-06-16 19:42 JST
- Completed: 2026-06-16 19:42 JST
- Model: Opus 4.8
- Branch: feature/update-mermaid-editor

## 目的

ginokent/mermaid-editor の最新 `main` (`1ab9e78`、シーケンス図のメッセージからの
ノート追加機能 #35 込み) を親サイトへ再同期し、`/tools/mermaid-editor` に反映して
デプロイする。

## 経緯

ユーザー要望「最新の mermaid-editor をデプロイしたい」。直近で i18n 対応 (#33 で同期済み、
`8f227cf`) に続き、メッセージからの「ノートを追加 (上/下)」(#35) が上流 main にマージされた。
これを取り込む。

## 実施内容

- `scripts/sync-mermaid-editor.sh ../mermaid-editor origin/main` でロジックを `1ab9e78` まで
  無改変同期 (`core/i18n.ts` / `editor.ts` / `ui/overlay.ts` 更新、SOURCE スタンプ更新)。
- グルー元ファイル (`index.html` / `src/main.ts` / `src/style.css`) に変化は無く、
  `src/pages/tools/mermaid-editor.astro` 等の `.astro` の手当ては不要。
- `pnpm run build` 緑 (322 ページ)。

## 完了条件

1. SOURCE が `1ab9e78` を指し、同期ロジックにノート追加 (`onAddNoteAtMessage` 等) が含まれる。 ... 達成
2. `pnpm run build` 緑。 ... 達成
3. `main` へマージするとデプロイ workflow が走り、ライブに最新版が反映される。 ... マージ待ち

## デプロイ

`.github/workflows/deploy.yml` が `main` への push で自動実行 (GitHub Pages)。本ブランチを
PR 経由で `main` にマージすればデプロイされる。
