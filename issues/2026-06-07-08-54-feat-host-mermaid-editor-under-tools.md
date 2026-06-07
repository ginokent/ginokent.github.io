# mermaid-editor を /tools/mermaid-editor/ としてホストする

- Priority: Medium
- Created: 2026-06-07 08:54 JST
- Completed:
- Model: Opus 4.8
- Branch: feature/add-mermaid-editor-tool

## 目的

別リポジトリ `ginokent/mermaid-editor` (Vite + TypeScript の完全クライアントサイド静的アプリ) を、本ブログの `/tools/` セクション配下 `/tools/mermaid-editor/` で公開する。既存の `/tools/ocr/` と同じく「ブラウザだけで動くツール集」の一員として提供する。

## 経緯

ユーザーから「mermaid-editor を ginokent.github.io の tools としてホストできるか」と相談を受けた。調査の結果、ホスト先は Astro 静的サイト (GitHub Pages 自動デプロイ) で `/tools/` セクションが既に存在し、mermaid-editor は `dist/` を吐く純クライアントサイドアプリのため、静的ホスティングで完結できると判明した。統合方式は複数案を提示し、ユーザーは「Astro ページへの移植」を選択した。さらに「最新の mermaid-editor を再移植する作業が繰り返されるため、再現性のある手順や skill を残す」ことを要望された。

## 優先度根拠

新機能追加であり障害・セキュリティリスクはない。一方でツール公開とその再現性ある運用手順は今後のレバレッジが大きいため Medium とする。

## 現状・問題

- mermaid-editor は別リポジトリの Vite アプリで、本ブログ (Astro) には未統合
- 単純コピーでは mermaid-editor の `style.css` が持つ裸セレクタ (`body` / `header h1` / `header p` / `main`) が BaseLayout と衝突する
- 再移植が反復作業になるため、手順を口伝に頼ると再現性が失われる

## 完了条件

- `/tools/mermaid-editor/` でエディタが動作する (描画・クリック編集・ダブルクリック編集・Undo/Redo・SVG/PNG 書き出し・共有 URL・localStorage 復元)
- BaseLayout 由来のサイト全体の見た目 (`body` / `header` / `main`) が壊れない
- `/tools/` 一覧から導線がある
- 最新の mermaid-editor を再移植するための再現可能な手順 (sync スクリプト + skill) が存在する

## 解決方法

- 純ロジック (`editor.ts` / `core/**` / `ui/**`) は無改変で `src/scripts/mermaid-editor/` へコピーする
- ブログ常駐グルーとして `src/pages/tools/mermaid-editor.astro` を作成する (マークアップ + `main.ts` 由来の `<script>` + 再スコープ済み `<style is:global>`)
- `package.json` に `mermaid` を追加する
- `src/pages/tools/index.astro` に導線を 1 件追加する
- 再現性のため `scripts/sync-mermaid-editor.sh` (ロジックの自動コピー + 上流 glue 変更の差分警告 + ソース SHA 記録) と `.claude/skills/port-mermaid-editor/SKILL.md` を用意する

## 設計方針

- 「ロジックは毎回そのまま同期、グルー (CSS・ページ枠・bootstrap) は一度書いて保守」という分離で再ポートのコストと事故を最小化する
- 同期ロジックとグルー CSS の接点はクラス名・DOM id の契約であり、上流での変更を sync スクリプトの差分警告で検知できるようにする
- ロジックのアルゴリズムには手を入れない (上流の正本を尊重し drift を一方向に限定する)
