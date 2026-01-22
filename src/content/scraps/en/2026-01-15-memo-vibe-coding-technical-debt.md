---
title: "Memo: Personal Stance on Technical Debt from Vibe Coding (2026-01-15 version)"
publishedAt: 2026-01-15T09:00:00+09:00
tags: ["Memo", "Vibe Coding", "Technical Debt"]
---

If neither the reviewee nor reviewer can explain "why this was done this way" and "what this enables" for the code under review, it becomes debt the moment it's merged—whether written by hand or by AI.

This is the type of debt where unexplainable code creeps into an ideally fully-explainable codebase as a broken window.

Deciding not to maintain a fully-explainable state is absolutely a valid decision.

However, production services in the real world aren't run pastorally enough to simply accept that.
