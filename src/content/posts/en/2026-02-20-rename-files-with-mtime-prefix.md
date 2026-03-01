---
title: "A One-Liner to Prefix Filenames with Their Last Modified Date"
description: "A one-liner to prefix files under the current directory with their last modified date."
publishedAt: 2026-02-20T09:00:00+09:00
tags: ["Bash", "One-liner"]
---

## One-Liner

```bash
for f in *; do [ -f "$f" ] && mv "$f" "$(stat -f '%Sm' -t '%Y%m%dT%H%M%S' "$f")_$f"; done
```

For each file in the current directory, this retrieves the last modified date using `stat` and renames the file by prepending a prefix in the format `YYYYMMDDTHHmmSS_`.

On Linux, the `stat` options differ.

```bash
for f in *; do [ -f "$f" ] && mv "$f" "$(stat -c '%Y' "$f" | xargs -I{} date -d @{} '+%Y%m%dT%H%M%S')_$f"; done
```

## Example

```console
$ ls
bar.md  baz.md  foo.md

$ for f in *; do [ -f "$f" ] && mv "$f" "$(stat -f '%Sm' -t '%Y%m%dT%H%M%S' "$f")_$f"; done

$ ls
20260218T143012_bar.md  20260220T091530_baz.md  20260215T220845_foo.md
```

You can now tell at a glance which files are the most recent.

## What I Used This For

The plan files that Claude Code's Plan agent generates in `.claude/plans/` use random UUIDs in their filenames and contain no information about when they were last modified. As plan files accumulate, it becomes impossible to tell which ones are the most recent. I solved this by batch-renaming them with the one-liner above.
