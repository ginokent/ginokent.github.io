#!/usr/bin/env bash
# i18n.sh - 日本語記事を英語に翻訳するスクリプト
#
# 使用方法:
#   ./scripts/i18n.sh [--tool <claude|gemini|codex>] [--force]
#
# オプション:
#   --tool <name>  翻訳に使用する CLI ツール (default: claude)
#   --force        既存の翻訳を上書き
#
# 例:
#   pnpm run i18n              # claude を使用
#   pnpm run i18n:gemini       # gemini-cli を使用
#   pnpm run i18n:codex        # codex を使用
#   pnpm run i18n -- --force   # 既存の翻訳を上書き

set -euo pipefail

TOOL="claude"
FORCE=false

# 引数をパース
while [[ $# -gt 0 ]]; do
  case $1 in
    --tool)
      TOOL="$2"
      shift 2
      ;;
    --force)
      FORCE=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# 翻訳プロンプト
TRANSLATE_PROMPT='Translate this Japanese markdown blog post to English.

Rules:
1. Translate the title in frontmatter to English
2. Keep the frontmatter format (YAML) unchanged except for translated text
3. Translate the body content to natural, fluent English
4. Keep all code blocks, links, and markdown formatting unchanged
5. Keep technical terms (like command names, file paths, etc.) as-is
6. Keep blockquotes (lines starting with ">") unchanged - do NOT translate them
7. Output ONLY the translated markdown, no explanations

Input markdown:'

# 翻訳関数
translate_directory() {
  local src_dir="$1"
  local label="$2"
  local en_dir="$src_dir/en"

  mkdir -p "$en_dir"

  for ja_file in "$src_dir"/*.md; do
    [[ -f "$ja_file" ]] || continue

    local filename
    filename=$(basename "$ja_file")
    local en_file="$en_dir/$filename"

    if [[ -f "$en_file" ]] && [[ "$FORCE" != "true" ]]; then
      echo "Skip: $label/$filename (already translated, use --force to overwrite)"
      continue
    fi

    echo "Translating: $label/$filename"
    local content
    content=$(cat "$ja_file")

    local translated
    case $TOOL in
      claude)
        translated=$(echo "$content" | claude -p "$TRANSLATE_PROMPT")
        ;;
      gemini)
        translated=$(echo "$TRANSLATE_PROMPT

$content" | gemini)
        ;;
      codex)
        translated=$(echo "$TRANSLATE_PROMPT

$content" | codex)
        ;;
      *)
        echo "Unknown tool: $TOOL"
        exit 1
        ;;
    esac

    echo "$translated" > "$en_file"
    echo "Created: $en_file"
  done
}

# 実行
translate_directory "src/content/posts" "posts"
translate_directory "src/content/scraps" "scraps"

echo "Done!"
