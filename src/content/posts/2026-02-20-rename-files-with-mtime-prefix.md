---
title: "ファイル名に最終更新日時の prefix を付与するワンライナー"
description: "カレントディレクトリ配下のファイルに最終更新日時を prefix として付与するワンライナー。"
publishedAt: 2026-02-20T09:00:00+09:00
tags: ["Bash", "ワンライナー"]
---

## ワンライナー

```bash
for f in *; do [ -f "$f" ] && mv "$f" "$(stat -f '%Sm' -t '%Y%m%dT%H%M%S' "$f")_$f"; done
```

カレントディレクトリ内の各ファイルについて `stat` で最終更新日時を取得し、`YYYYMMDDTHHmmSS_` の形式で prefix を付与してリネームする。

Linux の場合は `stat` のオプションが異なる。

```bash
for f in *; do [ -f "$f" ] && mv "$f" "$(stat -c '%Y' "$f" | xargs -I{} date -d @{} '+%Y%m%dT%H%M%S')_$f"; done
```

## 実行例

```console
$ ls
bar.md  baz.md  foo.md

$ for f in *; do [ -f "$f" ] && mv "$f" "$(stat -f '%Sm' -t '%Y%m%dT%H%M%S' "$f")_$f"; done

$ ls
20260218T143012_bar.md  20260220T091530_baz.md  20260215T220845_foo.md
```

どのファイルが新しいかが一目でわかるようになる。

## 何に使ったか

Claude Code の Plan エージェントが `.claude/plans/` に吐くファイルは、ファイル名にランダムな UUID が使われており最終更新日時の情報が含まれない。プランファイルが溜まってくると、どれが直近のものか判別がつかなくなる。上記のワンライナーで一括リネームして解決した。
