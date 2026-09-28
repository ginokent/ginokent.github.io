# Mermaid Editor を最新 (architecture-beta 対応) へ再同期してデプロイする

- Priority: Medium
- Created: 2026-09-25 14:06 JST
- Completed: 2026-09-25 14:06 JST
- Model: Opus 4.7
- Branch: feature/add-mermaid-editor-architecture-diagram

## 目的

ginokent/mermaid-editor の最新 `main` (`f05625d`) を親サイトへ再同期し、`architecture-beta`
図種の編集対応を `/tools/mermaid-editor` (ja) / `/en/tools/mermaid-editor` (en) に反映して
デプロイする。

## 取り込む変更 (前回同期 `5e74e49` → `f05625d`)

- architecture-beta 図種の編集対応 (mermaid-editor #48)
  - 対応要素: service / group / junction / エッジ
  - 編集: ラベル / アイコン / id リネーム / 追加 / 削除 / 接続 / エッジ接続点 (T/B/L/R) /
    線種 (`-->` / `--`) / 反転 / 再接続 / 親 group 変更
  - 除外: group ↔ group エッジ (`{group}` 修飾) / iconify カタログ GUI
- 新規テンプレート「アーキテクチャ」(Web Application Architecture)
- i18n 拡張 (field.icon / archSide / archLinkKind / arch 用 menu・hint 文言)

## グルー手当て

- **不要**: 上流の `index.html` / `src/main.ts` / `src/style.css` は変化無し (sync-mermaid-editor.sh
  の変化検出でも「グルー元ファイルに変化なし」と報告)
- ツールバー: architecture 図種は図種別ボタン (direction / autonumber のような) を持たないため
  `[data-diagram]` の追加不要
- テンプレートボタン: `<span id="templates">` へ TEMPLATES から動的生成しているため
  「アーキテクチャ」ボタンは自動追加される
- CSS: architecture 用に新規のクラスは無く、既存の `.hit` / `.menu` / `.inline-input` を再利用

## 実施内容

- `scripts/sync-mermaid-editor.sh ../mermaid-editor origin/main` でロジックを `f05625d` まで
  無改変同期 (SOURCE スタンプ更新)
- 追加: `src/scripts/mermaid-editor/core/source/architecture.ts` (トークナイザ + 編集ヘルパ)
- 更新: adapter / correlate / editor / i18n / overlay / templates / types
- `pnpm run build` 緑 (322 ページ)

## デプロイ

`.github/workflows/deploy.yml` が `main` への push で自動実行 (GitHub Pages)。本ブランチを
PR 経由で `main` にマージすればデプロイされる。
