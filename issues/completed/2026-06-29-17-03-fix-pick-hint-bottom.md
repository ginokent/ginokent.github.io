# 選択モードのヒントがサイトヘッダに覆われて見えない (グルー修正)

- Priority: High
- Created: 2026-06-29 17:03 JST
- Completed: 2026-06-29 17:03 JST
- Model: Opus 4.8
- Branch: feature/fix-pick-hint-bottom

## 不具合 (ユーザー報告)

`/tools/mermaid-editor` で「xx からの送信先」などの選択モード表示がどこにも表示されない。

## 原因

mermaid-editor #45 (再同期 #37 で取り込み) で `.pick-hint` をビューポート上端固定
(`position: fixed; top: 12px; z-index: 40`) にしたが、本サイトの `<header>` は
`position: sticky; top: 0; z-index: 100` (`src/styles/global.css`) のため、上端のヒントが
ヘッダ (z-index 100 > 40) に覆われて見えなくなっていた。

## 修正

- `src/components/MermaidEditor.astro` の `<style>` の `.mermaid-editor .pick-hint` を
  ビューポート下端中央 (`bottom: 16px`) へ固定。サイトヘッダは上部のため衝突しない。
  保険として z-index を 1000 (ヘッダ 100 超) に上げる
- ロジック変更は無く、グルー (CSS) のみの手当て。再同期は不要

## 検証

- `pnpm run build`: 322 ページ・緑
- 標準版 (mermaid-editor) では Playwright + Chromium で下端中央の最前面表示を確認済み

## 関連

- mermaid-editor 側 (源泉): `feature/fix-pick-hint-bottom` (style.css を同様に bottom へ)
