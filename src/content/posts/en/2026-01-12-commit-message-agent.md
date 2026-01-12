---
title: "Save Main Agent Context in Claude Code by Using Subagents to Generate Conventional Commits Messages"
description: "This post explains how to save main agent context in Claude Code by using subagents to generate Conventional Commits messages."
publishedAt: 2026-01-12
updatedAt: 2026-01-12
tags: ["Claude Code", "Git", "Conventional Commits", "AI"]
---

## Motivation

When having Claude Code generate commit messages, I noticed that large `git diff` outputs waste the main agent's context. So I decided to delegate this task to a subagent.

By using subagents, you can execute processing in an independent context window. This allows you to generate commit messages while preserving the main agent's context.

## What is a Subagent?

A subagent is an AI agent dedicated to tasks delegated from the main agent.

Key features:

- **Independent context window**: Processing within the subagent doesn't consume the main agent's context
- **Dedicated system prompt**: You can set task-specific instructions
- **Tool restrictions**: You can allow only necessary tools
- **Automatic delegation**: Automatically invoked based on task content

## The Subagent I Created

I created a subagent that suggests 5 English commit messages in Conventional Commits format.

```markdown .claude/agents/commit-message.md
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

## Installation

Place the markdown above at the user level (`~/.claude/agents/commit-message.md`) or project level (`.claude/agents/commit-message.md`).

## Usage

Simply ask Claude Code like this:

```
コミットメッセージを考えて
```

or

```
commit message
```

The subagent will be automatically invoked and present 5 candidates. Choose your favorite and commit.

```
$ claude
> コミットメッセージを考えて

[Delegating to commit-message subagent]

Please choose from the following candidates:

1. feat(api): add user deletion endpoint
2. feat(users): implement delete user functionality
3. feat: add user deletion with validation
4. feat(api): support user deletion with error handling
5. refactor(users): add deleteUser function

> 1 でコミットして

[Executing git commit -m "feat(api): add user deletion endpoint"]
```

## Key Points

### If You Want the Agent to Handle Committing Too

By including instructions at the end of the subagent's output, you can prompt the main agent to use specific tools.

By modifying the Output Format as shown below, the main agent will use the `AskUserQuestion` Tool to ask the user to select an option, then execute the commit.

```markdown .claude/agents/commit-message.md
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

If you want to commit manually, omit this instruction.

### Include MUST BE USED in the Description

To ensure automatic delegation to the subagent, it's important to use strong wording in the `description`.

```yaml .claude/agents/commit-message.md
# Less likely to be auto-delegated
description: Generate commit messages in Conventional Commits format.

# More likely to be auto-delegated
description: MUST BE USED when generating commit messages or when user mentions "commit", "コミット", "コミットメッセージ".
```

By explicitly stating "MUST BE USED," Claude can accurately determine when to delegate the task.

### Context Saving Benefits

Since subagents operate in an independent context window, no matter how large the `git diff` output is, it won't affect the main agent's context.

Only the subagent's final output (the 5 commit message candidates) is returned to the main agent.

### Language Handling

I've configured it so that commit messages are consistently in English, while explanations and error messages match the user's language. If you communicate in Japanese, you'll get responses in Japanese, but only the commit messages will be in English.

## Summary

By using Claude Code's subagent feature, you can save context while streamlining routine tasks.

Beyond commit message generation, this can be applied to any task you want to process in an independent context, such as code reviews, test generation, and documentation creation.

## References

- [Create custom subagents - Claude Code Docs](https://code.claude.com/docs/en/sub-agents)
- [Conventional Commits](https://www.conventionalcommits.org/)
