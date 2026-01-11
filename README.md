# Tech Blog

Astro で構築したミニマルな技術ブログ。

## セットアップ

```bash
# 依存関係のインストール
npm install

# 開発サーバー起動
npm run dev

# ビルド
npm run build

# プレビュー
npm run preview
```

## 記事の追加

`src/content/posts/` にマークダウンファイルを追加します。

```markdown
---
title: "記事タイトル"
description: "記事の説明"
publishedAt: 2025-01-12
updatedAt: 2025-01-12  # 任意
tags: ["tag1", "tag2"]
draft: false  # true で非公開
---

本文をここに書く...
```

## GitHub Pages へのデプロイ

1. リポジトリの Settings → Pages → Source を「GitHub Actions」に設定
2. `astro.config.mjs` の `site` を実際の URL に変更
3. main ブランチに push すると自動デプロイ

## ディレクトリ構成

```
src/
├── content/posts/    # マークダウン記事
├── layouts/          # レイアウト
├── pages/            # ページ
├── components/       # コンポーネント
└── styles/           # CSS
```
