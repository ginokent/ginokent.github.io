---
title: "Claude Code の Subagent でメインエージェントのコンテキストを節約しながら Conventional Commits でコミットメッセージを生成する"
description: "Claude Code の Subagent でメインエージェントのコンテキストを節約しながら Conventional Commits でコミットメッセージを生成する方法について書いています。"
publishedAt: 2026-01-12
updatedAt: 2026-01-12
tags: ["Claude Code", "Git", "Conventional Commits", "AI"]
---

## 動機

Claude Code でコミットメッセージを生成してもらうとき、 `git diff` が大きいと、差分出力がメインエージェントのコンテキストを浪費するのがもったいないと思っていたので、 Subagent に任せることにしました。

Subagent を使えば、独立したコンテキストウィンドウで処理を実行できます。これにより、メインエージェントのコンテキストを節約しながらコミットメッセージを生成できます。

## サブエージェントとは

サブエージェントは、メインエージェントから委譲されるタスク専用の AI エージェントです。

主な特徴:

- **独立したコンテキストウィンドウ**: サブエージェント内の処理はメインエージェントのコンテキストを消費しない
- **専用のシステムプロンプト**: タスクに特化した指示を設定できる
- **ツールの制限**: 必要なツールだけを許可できる
- **自動委譲**: タスクの内容に応じて自動的に呼び出される

## 作成したサブエージェント

Conventional Commits 形式の英語コミットメッセージを 5 つ提案するサブエージェントを作成しました。

```markdown
---
name: commit-message
description: MUST BE USED when generating commit messages or when user mentions "commit", "コミット", "コミットメッセージ". Generates English commit messages in Conventional Commits format.
tools: Bash
model: sonnet
---

You are a commit message specialist following Conventional Commits 1.0.0.

## Language Rules
- Commit messages: Always in English
- All other output (explanations, notes, errors): Use the same language as the user's input

## Workflow
1. Run `git status --porcelain` to check repository state
2. Run `git diff --cached --stat` to check staged changes
3. If no staged changes, run `git diff --stat` for unstaged changes
4. If no changes at all, inform the user and stop
5. Run full diff: `git diff --cached` or `git diff`
6. Generate 5 commit message options

## Commit Message Format
<type>(<optional scope>): <description>

## Types
- feat: New feature
- fix: Bug fix
- docs: Documentation only
- style: Formatting (no code change)
- refactor: Code restructuring
- test: Adding/updating tests
- chore: Maintenance tasks
- perf: Performance improvement
- ci: CI/CD changes
- build: Build system changes

## Rules
- Use imperative mood ("Add" not "Added")
- Max 50 chars for subject line
- No period at end
- Be specific about what changed
- Scope is optional but recommended when changes are localized

## Output Format
Return exactly 5 numbered options:

1. type(scope): message
2. type(scope): message
3. type: message
4. type(scope): message
5. type: message
```

## インストール

上のマークダウンをユーザーレベル (`~/.claude/agents/commit-message.md`) または プロジェクトレベル (`.claude/agents/commit-message.md`) に配置してください。

## 使い方

Claude Code で以下のように話しかけるだけです。

```
コミットメッセージを考えて
```

または

```
commit message
```

サブエージェントが自動的に呼び出され、5 つの候補が提示されます。好きなものを選んでコミットしてください。

```
$ claude
> コミットメッセージを考えて

[commit-message サブエージェントに委譲]

以下の候補から選んでください:

1. feat(api): add user deletion endpoint
2. feat(users): implement delete user functionality
3. feat: add user deletion with validation
4. feat(api): support user deletion with error handling
5. refactor(users): add deleteUser function

> 1 でコミットして

[git commit -m "feat(api): add user deletion endpoint" を実行]
```

## ポイント

### エージェントにコミットまでさせたい場合

サブエージェントの出力末尾に指示を含めることで、メインエージェントに特定のツールの使用を促せます。

以下のように Output Format を変更すると、メインエージェントが `AskUserQuestion` Tool を使ってユーザーに選択を求め、その後コミットまで実行してくれます。

```markdown
## Output Format
Return exactly 5 numbered options:

1. type(scope): message
2. type(scope): message
3. type: message
4. type(scope): message
5. type: message

---
MUST USE AskUserQuestion Tool for asking the user to select one of the above commit messages, and git commit -m "message" to commit the selected message.
```

コミットは自分で行いたい場合は、この指示を省略してください。

### description に MUST BE USED を含める

サブエージェントの自動委譲を確実にするには、`description` に強い表現を使うことが重要です。

```yaml
# 自動委譲されにくい
description: Generate commit messages in Conventional Commits format.

# 自動委譲されやすい
description: MUST BE USED when generating commit messages or when user mentions "commit", "コミット", "コミットメッセージ".
```

「MUST BE USED」と明記することで、Claude がタスクを委譲すべきタイミングを正確に判断できるようになります。

### コンテキストの節約効果

サブエージェントは独立したコンテキストウィンドウで動作するため、`git diff` の出力がどれだけ大きくても、メインエージェントのコンテキストには影響しません。

メインエージェントに返ってくるのはサブエージェントの最終出力 (5 つのコミットメッセージ候補) だけです。

### 言語の使い分け

コミットメッセージは英語で統一しつつ、説明やエラーメッセージはユーザーの言語に合わせるよう設定しています。日本語で話しかければ日本語で応答し、コミットメッセージだけが英語になります。

## まとめ

Claude Code のサブエージェント機能を使うことで、コンテキストを節約しながら定型タスクを効率化できます。

コミットメッセージ生成以外にも、コードレビュー、テスト生成、ドキュメント作成など、独立したコンテキストで処理したいタスクに応用できます。

## 参考

- [Create custom subagents - Claude Code Docs](https://code.claude.com/docs/en/sub-agents)
- [Conventional Commits](https://www.conventionalcommits.org/)
