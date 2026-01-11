---
title: "git-ignore: .gitignore をコマンド一発で生成する CLI ツール"
description: "git-ignore は、指定した言語の .gitignore をコマンド一発で生成する CLI ツールです。"
publishedAt: 2025-01-01
updatedAt: 2026-01-12
tags: ["Git", "GitHub", "bash"]
---

## 開発の動機

新しいプロジェクトを作成するたびに `.gitignore` を用意する必要がありますが、毎回 GitHub の gitignore リポジトリを開いてコピペするのは手間ですし、 [gitignore.io](https://www.toptal.com/developers/gitignore) のような Web サービスもありますが、ターミナルから離れずに完結させたいと思いました。

そこで、コマンド一発で `.gitignore` を生成できるシンプルな CLI ツールを作りました。

[![hakadoriya/git-ignore](https://opengraph.githubassets.com/1/hakadoriya/git-ignore)](https://github.com/hakadoriya/git-ignore)

## 概要

新しいプロジェクトを始めるたびに `.gitignore` を手動で作成するのはコンテキストスイッチが多く面倒です。

`git-ignore` は、指定した言語の `.gitignore` をコマンド一発で生成する CLI ツールです。[GitHub 公式の gitignore テンプレート](https://github.com/github/gitignore) から最新の内容を取得します。

## インストール

```bash
curl -fLRSs https://raw.githubusercontent.com/hakadoriya/git-ignore/HEAD/git-ignore -o /tmp/git-ignore && \
  chmod +x /tmp/git-ignore && \
  sudo mv /tmp/git-ignore /usr/local/bin/
```

## 使い方

```bash
# Go プロジェクトの .gitignore を生成
git-ignore create go > .gitignore

# Python の場合
git-ignore new python > .gitignore

# 短縮形も使える
git-ignore c rust > .gitignore
```

サブコマンド `create`, `c`, `new` はすべて同じ動作をします。

## git サブコマンドとしての利用

git は PATH 上に `git-xxx` という名前の実行可能ファイルが存在すると、`git xxx` としてサブコマンドのように呼び出せる仕組みを持っています。

そのため `git-ignore` を PATH の通ったディレクトリに配置すると、以下のように `git ignore` として使えます。

```bash
git ignore create go > .gitignore
```

`git init` の直後に `git ignore` で `.gitignore` を生成する、という自然なワークフローが実現できます。

## 対応言語

主な対応言語:

| 言語 | エイリアス |
|------|-----------|
| Go | `go`, `golang` |
| Python | `python`, `py` |
| Rust | `rust`, `rs` |
| Node.js | `node`, `nodejs`, `js`, `ts` |
| C++ | `cpp`, `cc`, `cxx` |
| Ruby | `ruby`, `rb` |
| Swift | `swift` |
| Kotlin | `kotlin`, `kt` |
| Terraform | `terraform`, `tf` |

上記以外でも、[GitHub gitignore リポジトリ](https://github.com/github/gitignore) に存在する言語名をそのまま指定すれば取得できます。

```bash
# 例: Haskell
git-ignore create Haskell > .gitignore
```

## self-update による自己更新

スクリプト自身を最新版に更新できます。

```bash
git-ignore self-update
```

更新前後の差分が表示されるので、変更内容を確認できます。

## 仕組み

内部では `curl` を使って GitHub の Raw URL からテンプレートを取得しています。

```
https://raw.githubusercontent.com/github/gitignore/refs/heads/main/{言語名}.gitignore
```

依存関係は `curl` のみで、単一の Bash スクリプトとして動作します。
