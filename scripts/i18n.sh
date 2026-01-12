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

POSTS_DIR="src/content/posts"
EN_DIR="$POSTS_DIR/en"
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

# en ディレクトリがなければ作成
mkdir -p "$EN_DIR"

# 翻訳プロンプト
TRANSLATE_PROMPT='Translate this Japanese markdown blog post to English.

Rules:
1. Translate the title in frontmatter to English
2. Keep the frontmatter format (YAML) unchanged except for translated text
3. Translate the body content to natural, fluent English
4. Keep all code blocks, links, and markdown formatting unchanged
5. Keep technical terms (like command names, file paths, etc.) as-is
6. Output ONLY the translated markdown, no explanations

Input markdown:'

# 日本語記事を取得（en/ 以外のファイル）
for ja_file in "$POSTS_DIR"/*.md; do
  # ファイルが存在しない場合はスキップ
  [[ -f "$ja_file" ]] || continue

  filename=$(basename "$ja_file")
  en_file="$EN_DIR/$filename"

  # 既に翻訳済みでフォースモードでない場合はスキップ
  if [[ -f "$en_file" ]] && [[ "$FORCE" != "true" ]]; then
    echo "Skip: $filename (already translated, use --force to overwrite)"
    continue
  fi

  echo "Translating: $filename"

  # 日本語記事の内容を読み取り
  content=$(cat "$ja_file")

  # ツールに応じて翻訳を実行
  case $TOOL in
    claude)
      # Claude Code を使用
      translated=$(echo "$content" | claude -p "$TRANSLATE_PROMPT")
      ;;
    gemini)
      # gemini-cli を使用
      translated=$(echo "$TRANSLATE_PROMPT

$content" | gemini)
      ;;
    codex)
      # codex を使用
      translated=$(echo "$TRANSLATE_PROMPT

$content" | codex)
      ;;
    *)
      echo "Unknown tool: $TOOL"
      exit 1
      ;;
  esac

  # 翻訳結果を保存
  echo "$translated" > "$en_file"
  echo "Created: $en_file"
done

echo "Done!"
