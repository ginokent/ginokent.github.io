---
name: port-mermaid-editor
description: >-
  ginokent/mermaid-editor の最新を /tools/mermaid-editor/ へ再ポート (同期・更新) する手順。
  「mermaid-editor を取り込み直す」「mermaid エディタを最新にする」「mermaid-editor を
  ホスト更新する」等の依頼時に使う。ロジックは sync スクリプトで無改変同期し、グルー
  (ページ枠・bootstrap・CSS) は手当てが要るかを判断して反映する。
---

# mermaid-editor の再ポート手順

別リポジトリ `ginokent/mermaid-editor` (Vite + TS の完全クライアントサイド静的アプリ) を
本サイトの `/tools/mermaid-editor/` として取り込む / 最新へ更新するための再現手順。

## 設計 (なぜこの分担か)

2 つは別フレームワーク (Astro と Vite) の別リポジトリなので、コードを次の 2 種に分けて扱う。

- **同期ロジック (毎回そのまま・無改変コピー)**: `editor.ts` / `core/**` / `ui/**`。
  ビルドツール依存もパス依存もない純ロジックで、上流の正本テストで守られている。
  `src/scripts/mermaid-editor/` 配下に置く。**手で編集しない。**
- **常駐グルー (一度書いて保守)**: `src/pages/tools/mermaid-editor.astro`。
  上流 `index.html` の body 由来のマークアップ、`src/main.ts` 由来の `<script>` bootstrap、
  `src/style.css` を `.mermaid-editor` 配下へ再スコープした `<style is:global>` から成る。

ロジックとグルーの接点は **CSS クラス名 / DOM id の契約**。上流がボタン・要素・クラスを
増減すると、同期ロジックは変わるがグルーは追従しないため、ここだけ手当てが要る。

## 手順

### 1. 上流を取得

```sh
git -C ../mermaid-editor fetch origin
```

`../mermaid-editor` が無ければ任意の場所に clone し、後続でそのパスを渡す。

### 2. ロジックを同期

```sh
scripts/sync-mermaid-editor.sh                      # 既定: ../mermaid-editor を origin/main で
scripts/sync-mermaid-editor.sh /path/to/mermaid-editor origin/main   # パス/ref を指定する場合
```

スクリプトは `editor.ts` / `core/` / `ui/` を `git archive` でバイト一致取得し
(`*.test.ts` と test シムは除外、`flowchart.ts` の NUL バイトも保持)、`SOURCE` スタンプの
commit を更新する。

### 3. グルー変更の警告に対応

前回同期からの差分で `index.html` / `src/main.ts` / `src/style.css` が変化していれば
スクリプトが警告する。**警告が出たら** `mermaid-editor.astro` を手当てする:

- `index.html` 変化 → マークアップ (ボタン・新 DOM id・パネル構成) を `.astro` の body へ反映。
  ただし上流の `<body>`/`<header>`/`<main>` の殻は持ち込まず `.mermaid-editor` /
  `.me-header` / `.me-panes` コンテナへ閉じ込める (BaseLayout がサイトの body/header/main を持つ)。
- `src/main.ts` 変化 → `.astro` の `<script>` bootstrap に反映。import パスは
  `../../scripts/mermaid-editor/...` に向け、`import "./style.css"` は持ち込まない。
- `src/style.css` 変化 → `.astro` の `<style is:global>` に反映。**全セレクタを
  `.mermaid-editor` 配下へ再スコープ**し、裸セレクタは次のとおり読み替える:
  `body` は破棄 (BaseLayout が所有) / `header h1`・`header p` → `.me-header h1`・`.me-header p` /
  `main` → `.me-panes`。`.hit`/`.menu`/`.inline-input` 等は overlay.ts が動的生成するため
  scoped style では当たらず、`is:global` 必須。エディタは light 前提の自己完結ウィジェットとして
  色を固定し、サイトの dark テーマでも内部の可読性を保つ。

警告が出なければ `.astro` の手当ては不要。

### 4. 検証

```sh
pnpm run build   # 型・ビルド (移植ページがバンドルされ必須 DOM id が出力されることを確認)
pnpm run dev     # /tools/mermaid-editor/ を開く
```

ブラウザで以下を必ず実機確認する (jsdom/ヘッドレスでは座標・描画を検証しきれない):
描画 / クリックでメニュー / ダブルクリックでラベル編集 / Undo・Redo /
SVG・PNG 書き出し / 共有 URL (`#code=` ハッシュ) / localStorage 復元 /
そして **サイト全体の body・header・main の見た目が壊れていない**こと (CSS 再スコープの検証)。

### 5. コミット

意味のある単位でコミットする。`SOURCE` スタンプの commit (同期元 SHA) を含めること。

## 触ってはいけないもの

- `src/scripts/mermaid-editor/` 配下のロジックを手で編集しない。直したい挙動があれば
  **上流 `ginokent/mermaid-editor` を直し**、再同期する (drift を一方向に保つ)。
- sync スクリプトで sed 等のテキスト変換をしない。`flowchart.ts` は複合キー区切りに
  NUL バイトを含む (意図的) ため、バイト一致を壊さないこと。
