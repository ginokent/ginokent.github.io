# ginokent Blog - プロジェクト構築経緯

## プロジェクト概要

GitHub Pages でホストする個人用テックブログ。Zenn のようにマークダウンで記事を書き、SSG でビルドするスタイル。

## 技術選定

### SSG フレームワーク: Astro

候補として Hugo, Astro, Zola, VitePress, Jekyll を検討し、Astro を選択。

選定理由:
- モダンな構成
- 柔軟なカスタマイズ性
- MDX 対応など拡張性

### パッケージマネージャー: pnpm

npm から pnpm に移行。

### テーマ

既存テーマは使用せず、ゼロから作成。

## 実施した変更・調整

### 1. 基本構成の構築
- Astro プロジェクトの初期セットアップ
- ページ構成: トップページ（記事一覧）、記事詳細、タグ別一覧、RSS フィード
- Content Collection による記事管理（Zod スキーマでバリデーション）

### 2. ダーク/ライトモード対応
- システム設定追従 + 手動切り替え
- localStorage でテーマを永続化
- フラッシュ防止のためインラインスクリプトで初期化

### 3. コードブロックのシンタックスハイライト
- Shiki による dual theme 対応（github-light / github-dark）
- `defaultColor: false` 設定で両テーマを CSS 変数で制御（一貫性重視）
- ライトモードの背景色を `--bg-secondary` に変更（ページ背景と区別するため）

### 4. レイアウト調整
- トップページ: タグ表示を削除、タイトル全文表示（折り返し可）
- 記事一覧: 最上部・最下部の線を削除
- ヘッダーとコンテンツ間の余白調整
- Sticky footer の実装（flexbox）

### 5. SEO / OGP 対応
- OGP / Twitter Card メタタグ
- robots.txt の追加
- @astrojs/sitemap による sitemap 自動生成
- RSS フィード

### 6. About ページの追加
- プロフィール画像（左）+ 自己紹介（右）のレイアウト
- GitHub / X へのリンク（SVG アイコン）
- Header に About リンクを追加

### 7. GitHub Actions デプロイ
- main ブランチへの push で自動デプロイ
- GitHub Pages へのデプロイ設定

### 8. pnpm への移行
- npm から pnpm に移行
- GitHub Actions の deploy.yml を pnpm 用に更新
- `pnpm/action-setup@v4` を使用

### 9. スマートフォン対応（レスポンシブ）
- 問題: スマートフォンでコンテンツが右にはみ出していた
- 原因: `main.container` に `width` が明示的に設定されていなかったため、子要素のコンテンツに応じて幅が広がっていた
- 解決: `main.container` に `width: 100%` を追加
- 追加対応:
  - `.article-content` に `overflow-wrap: break-word`, `word-break: break-word` を追加（長い URL の折り返し）
  - `.article-content pre` に `max-width: 100%`, `width: 100%` を追加
  - `.article-content table` に `display: block`, `overflow-x: auto` を追加（広いテーブルの横スクロール）

## 最終的なディレクトリ構成

```
ginokent.github.io/
├── src/
│   ├── content/
│   │   ├── config.ts
│   │   └── posts/           # マークダウン記事
│   ├── layouts/
│   │   └── BaseLayout.astro
│   ├── pages/
│   │   ├── index.astro      # 記事一覧
│   │   ├── about.astro      # About ページ
│   │   ├── posts/[slug].astro
│   │   ├── tags/[tag].astro
│   │   └── feed.xml.ts
│   ├── components/
│   │   ├── Header.astro
│   │   └── TableOfContents.astro
│   └── styles/
│       └── global.css
├── public/
│   ├── favicon.svg
│   ├── og-default.png
│   ├── ginokent.png
│   └── robots.txt
├── .github/
│   └── workflows/
│       └── deploy.yml
├── astro.config.mjs
├── tsconfig.json
├── package.json
└── pnpm-lock.yaml
```

## 技術的な決定事項

| 項目 | 決定 | 理由 |
|------|------|------|
| パッケージマネージャー | pnpm | 高速、ディスク効率が良い |
| Shiki defaultColor | `false` | ライト/ダーク両方を CSS 変数で制御し一貫性を持たせる |
| コードブロック背景（ライト） | `--bg-secondary` | ページ背景と区別するため |
| Sticky footer | flexbox | シンプルで信頼性が高い |
| SNS リンク | SVG アイコン | テキストよりビジュアルに訴求 |
| スマホ対応 | `main.container` に `width: 100%` | 子要素の幅膨張を防ぐ |

## 未実装・今後の拡張候補

- コードブロックのファイル名表示・コピーボタン
- 全文検索機能
- OGP 画像の自動生成
- タイトル内インラインコードのスタイル適用（検討中断）
