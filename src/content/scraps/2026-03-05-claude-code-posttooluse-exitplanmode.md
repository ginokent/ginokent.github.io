---
publishedAt: 2026-03-05T09:00:00+09:00
tags: ["Claude Code"]
---

plan ファイルの rename のために PostToolUse で ExitPlanMode を引っ掛けたいのに clear context してしまうと新しいセッションが開始されてしまっているから PostToolUse hook が効かない問題
