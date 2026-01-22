---
title: "git-ignore: A CLI Tool to Generate .gitignore with a Single Command"
description: "git-ignore is a CLI tool that generates .gitignore files for specified languages with a single command."
publishedAt: 2025-01-01T09:00:00+09:00
updatedAt: 2026-01-12T09:00:00+09:00
tags: ["Git", "GitHub", "bash"]
---

## Motivation

Every time I start a new project, I need to prepare a `.gitignore` file. Opening GitHub's gitignore repository and copy-pasting is tedious, and while web services like [gitignore.io](https://www.toptal.com/developers/gitignore) exist, I wanted to complete everything without leaving the terminal.

So I created a simple CLI tool that generates `.gitignore` files with a single command.

[![hakadoriya/git-ignore](https://opengraph.githubassets.com/1/hakadoriya/git-ignore)](https://github.com/hakadoriya/git-ignore)

## Overview

Manually creating a `.gitignore` every time you start a new project involves too much context switching and is cumbersome.

`git-ignore` is a CLI tool that generates `.gitignore` files for specified languages with a single command. It fetches the latest content from [GitHub's official gitignore templates](https://github.com/github/gitignore).

## Installation

```bash
curl -fLRSs https://raw.githubusercontent.com/hakadoriya/git-ignore/HEAD/git-ignore -o /tmp/git-ignore && \
  chmod +x /tmp/git-ignore && \
  sudo mv /tmp/git-ignore /usr/local/bin/
```

## Usage

```bash
# Generate .gitignore for a Go project
git-ignore create go > .gitignore

# For Python
git-ignore new python > .gitignore

# Short forms also work
git-ignore c rust > .gitignore
```

The subcommands `create`, `c`, and `new` all perform the same action.

## Using as a Git Subcommand

Git has a mechanism where if an executable file named `git-xxx` exists on your PATH, it can be invoked as `git xxx` like a subcommand.

Therefore, by placing `git-ignore` in a directory on your PATH, you can use it as `git ignore`:

```bash
git ignore create go > .gitignore
```

This enables a natural workflow of generating `.gitignore` with `git ignore` right after `git init`.

## Supported Languages

Main supported languages:

| Language | Aliases |
|----------|---------|
| Go | `go`, `golang` |
| Python | `python`, `py` |
| Rust | `rust`, `rs` |
| Node.js | `node`, `nodejs`, `js`, `ts` |
| C++ | `cpp`, `cc`, `cxx` |
| Ruby | `ruby`, `rb` |
| Swift | `swift` |
| Kotlin | `kotlin`, `kt` |
| Terraform | `terraform`, `tf` |

Beyond the above, you can specify any language name that exists in the [GitHub gitignore repository](https://github.com/github/gitignore) directly.

```bash
# Example: Haskell
git-ignore create Haskell > .gitignore
```

## Self-Update

The script can update itself to the latest version.

```bash
git-ignore self-update
```

A diff between the old and new versions is displayed so you can review the changes.

## How It Works

Internally, it uses `curl` to fetch templates from GitHub's Raw URL.

```
https://raw.githubusercontent.com/github/gitignore/refs/heads/main/{language}.gitignore
```

The only dependency is `curl`, and it runs as a single Bash script.
