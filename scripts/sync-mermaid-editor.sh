#!/usr/bin/env bash
# ginokent/mermaid-editor の純ロジック (editor.ts / core/ / ui/) を
# src/scripts/mermaid-editor/ へ無改変同期する。
#
# 設計: 「ロジックは毎回そのまま同期、グルー (ページ枠・bootstrap・CSS) は
# src/pages/tools/mermaid-editor.astro 側で一度書いて保守」という分離。
# このスクリプトはロジックのコピーのみを担い、グルーには触れない。
# 同期元コミットでグルーの元になった index.html / src/main.ts / src/style.css が
# 変化していれば警告し、.astro 側の手当てを促す。
#
# 使い方:
#   scripts/sync-mermaid-editor.sh [<mermaid-editor のパス>] [<git ref>]
#   既定: ../mermaid-editor を origin/main で同期する
#
# 注意:
#   - sed 等のテキスト変換は行わない。flowchart.ts は複合キー区切りに NUL バイトを
#     含む (意図的) ため、バイト一致を保つ cp のみを使う。
#   - *.test.ts と test/ シム (jsdom-svg.ts 等) は同期しない。ロジックの正本テストは
#     上流リポジトリ側にあり、本リポジトリでは実行しない。

set -euo pipefail

# このスクリプトの位置からリポジトリルートを解決する
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

UPSTREAM="${1:-$REPO_ROOT/../mermaid-editor}"
REF="${2:-origin/main}"
DEST="$REPO_ROOT/src/scripts/mermaid-editor"
STAMP="$DEST/SOURCE"

# グルーの元になっている上流ファイル。これらが変化したら .astro の手当てが要る
GLUE_SOURCES=("index.html" "src/main.ts" "src/style.css")

log() { printf '%s\n' "$*" >&2; }

if [[ ! -d "$UPSTREAM/.git" ]]; then
  log "error: upstream mermaid-editor not found as a git repo at: $UPSTREAM"
  log "hint: pass the path explicitly, e.g. scripts/sync-mermaid-editor.sh /path/to/mermaid-editor"
  exit 1
fi

git -C "$UPSTREAM" rev-parse --verify "$REF^{commit}" >/dev/null 2>&1 || {
  log "error: ref '$REF' not found in $UPSTREAM (try: git -C $UPSTREAM fetch origin)"
  exit 1
}

NEW_SHA="$(git -C "$UPSTREAM" rev-parse "$REF")"

# 直前に同期したコミット (あれば) をスタンプから読む
OLD_SHA=""
if [[ -f "$STAMP" ]]; then
  OLD_SHA="$(sed -n 's/^commit=//p' "$STAMP" | head -n1)"
fi

log "syncing logic from ginokent/mermaid-editor @ ${NEW_SHA:0:12} (ref: $REF)"

# 既存ロジックを一掃してから取り込む (上流での削除・リネームを反映するため)。
# SOURCE スタンプは残す。
rm -rf "$DEST/core" "$DEST/ui" "$DEST/editor.ts"
mkdir -p "$DEST"

# git archive で対象コミットの該当パスのみを取り出す。作業ツリーや index を一切汚さず、
# NUL バイトを含む flowchart.ts もバイト一致で取り出せる (read-only)。
TMP_TREE="$(mktemp -d)"
trap 'rm -rf "$TMP_TREE"' EXIT
git -C "$UPSTREAM" archive "$NEW_SHA" src/editor.ts src/core src/ui | tar -x -C "$TMP_TREE"

cp "$TMP_TREE/src/editor.ts" "$DEST/editor.ts"
cp -R "$TMP_TREE/src/core" "$DEST/core"
cp -R "$TMP_TREE/src/ui" "$DEST/ui"

# テストファイルと test シムは持ち込まない
find "$DEST" -name '*.test.ts' -delete
rm -rf "$DEST/test"

# スタンプを更新する
cat > "$STAMP" <<EOF
# このディレクトリ配下のロジック (editor.ts / core/ / ui/) は ginokent/mermaid-editor から
# scripts/sync-mermaid-editor.sh で無改変同期したもの。手で編集しないこと。
# グルー (ページ枠・bootstrap・CSS) は src/pages/tools/mermaid-editor.astro 側で保守する。
repo=ginokent/mermaid-editor
ref=$REF
commit=$NEW_SHA
synced_at=$(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M JST')
EOF

log "logic synced into src/scripts/mermaid-editor/"

# グルーの元ファイルが前回同期から変化していないか調べ、変化があれば警告する
if [[ -n "$OLD_SHA" && "$OLD_SHA" != "$NEW_SHA" ]]; then
  CHANGED="$(git -C "$UPSTREAM" diff --name-only "$OLD_SHA" "$NEW_SHA" -- "${GLUE_SOURCES[@]/#/}" 2>/dev/null || true)"
  if [[ -n "$CHANGED" ]]; then
    log ""
    log "⚠ 上流のグルー元ファイルが ${OLD_SHA:0:12}..${NEW_SHA:0:12} で変化している:"
    while IFS= read -r f; do log "    - $f"; done <<< "$CHANGED"
    log "  → src/pages/tools/mermaid-editor.astro のマークアップ / <script> bootstrap / <style> を"
    log "    上流の変更に合わせて手当てすること (新規ボタン・新規 DOM id・新規 CSS クラス等)。"
    log "  上流の該当差分の確認:"
    log "    git -C $UPSTREAM diff $OLD_SHA $NEW_SHA -- ${GLUE_SOURCES[*]}"
  else
    log "グルー元ファイル (${GLUE_SOURCES[*]}) に変化なし。.astro の手当ては不要の見込み。"
  fi
elif [[ -z "$OLD_SHA" ]]; then
  log "初回同期のため前回コミットとの差分比較はスキップした。"
fi

log ""
log "次の手順:"
log "  1. pnpm run build で型・ビルドを検証する"
log "  2. pnpm run dev で /tools/mermaid-editor/ を開き、描画・クリック編集・"
log "     ダブルクリック編集・Undo/Redo・SVG/PNG 書き出し・共有 URL・復元を実機確認する"
log "  3. 変更をコミットする (SOURCE スタンプの commit を含める)"
