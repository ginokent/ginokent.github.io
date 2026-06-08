import { INDENT, allLineRanges, deleteLines, insertStatement } from "../structure";
import type { BlockToken, BlockType, SourceRange, TextEdit } from "../types";
import { tokenizeSequence } from "./sequence";

// ソースモデル層 (シーケンス図): 制御ブロック (loop/alt/opt/par … end) の構造編集。
// すべて戦略 B (範囲保持書き戻し) の TextEdit 群として表現し、記述順・コメントを壊さない。
//   - 囲む (wrap):     連続メッセージを alt/opt/loop/par で囲む
//   - 解除 (unwrap):   囲みだけ消して中身を 1 段デデントして残す
//   - 種別変更:        キーワードを置換 (alt↔par では分岐 else↔and も変換)
//   - 分岐追加:        end の直前に else/and 行を挿入する

/** 新規ブロックの既定ラベル (種別ごと) */
const DEFAULT_LABEL: Record<BlockType, string> = {
  alt: "条件",
  opt: "任意",
  loop: "繰り返し",
  par: "並行処理",
};

/**
 * 連続するメッセージ行 (fromLine 〜 toLine) を type のブロックで囲む TextEdit 群。
 * 囲む範囲がブロックの開閉をまたぐ (well-nested でない) 場合は null を返す。
 */
export function wrapInBlockEdits(
  text: string,
  fromLine: SourceRange,
  toLine: SourceRange,
  type: BlockType,
): TextEdit[] | null {
  const first = fromLine.start <= toLine.start ? fromLine : toLine;
  const last = fromLine.start <= toLine.start ? toLine : fromLine;
  const lines = allLineRanges(text).filter((r) => r.start >= first.start && r.end <= last.end);
  if (!isBalanced(text, lines)) return null;

  const baseIndent = leadingWhitespace(text, first);
  const label = DEFAULT_LABEL[type];
  const edits: TextEdit[] = [];
  // ヘッダ行を first の前に挿入し、続けて first 行ぶんの追加インデントも与える
  edits.push({
    range: { start: first.start, end: first.start },
    newText: `${baseIndent}${type} ${label}\n${INDENT}`,
  });
  // first 以外の囲む行を 1 段インデント (空行は対象外)
  for (const ln of lines) {
    if (ln.start === first.start) continue;
    if (text.slice(ln.start, ln.end).trim() === "") continue;
    edits.push({ range: { start: ln.start, end: ln.start }, newText: INDENT });
  }
  // end 行を last の後に挿入
  edits.push({ range: { start: last.end, end: last.end }, newText: `\n${baseIndent}end` });
  return edits;
}

/** ブロックの囲み (ヘッダ・分岐・end) を消し、中身を 1 段デデントして残す TextEdit 群 */
export function unwrapBlockEdits(text: string, headerStart: number): TextEdit[] {
  const block = findBlock(text, headerStart);
  if (!block) return [];
  const removeRanges = [block.headerLineRange, ...block.branches.map((b) => b.lineRange), block.endLineRange];
  const edits = deleteLines(text, removeRanges);
  const removedStarts = new Set(removeRanges.map((r) => r.start));
  for (const ln of allLineRanges(text)) {
    if (ln.start <= block.headerLineRange.start || ln.start >= block.endLineRange.start) continue;
    if (removedStarts.has(ln.start)) continue;
    if (text.slice(ln.start, ln.end).startsWith(INDENT)) {
      edits.push({ range: { start: ln.start, end: ln.start + INDENT.length }, newText: "" });
    }
  }
  return edits;
}

/**
 * ブロックの種別を変更する TextEdit 群。
 * 分岐がある場合は alt↔par のみ許可し、分岐キーワード (else↔and) も併せて変換する。
 * 分岐があるのに opt/loop へ変えようとした場合は空配列 (UI 側でも抑止する)。
 */
export function setBlockTypeEdits(text: string, headerStart: number, newType: BlockType): TextEdit[] {
  const block = findBlock(text, headerStart);
  if (!block || block.type === newType) return [];
  const hasBranches = block.branches.length > 0;
  if (hasBranches && newType !== "alt" && newType !== "par") return [];
  const edits: TextEdit[] = [{ range: block.keywordRange, newText: newType }];
  if (hasBranches) {
    const newKw = newType === "par" ? "and" : "else";
    for (const b of block.branches) {
      if (text.slice(b.keywordRange.start, b.keywordRange.end) !== newKw) {
        edits.push({ range: b.keywordRange, newText: newKw });
      }
    }
  }
  return edits;
}

/** end の直前に分岐 (alt なら else、par なら and) を挿入する TextEdit 群 */
export function addBranchEdits(text: string, headerStart: number): TextEdit[] {
  const block = findBlock(text, headerStart);
  if (!block || (block.type !== "alt" && block.type !== "par")) return [];
  const keyword = block.type === "par" ? "and" : "else";
  const label = block.type === "par" ? "並行処理" : "条件";
  return [insertStatement(text, block.endLineRange, "before", `${keyword} ${label}`)];
}

// ---- 内部ヘルパ ----

function findBlock(text: string, headerStart: number): BlockToken | undefined {
  return tokenizeSequence(text).blocks.find((b) => b.headerLineRange.start === headerStart);
}

function leadingWhitespace(text: string, r: SourceRange): string {
  return /^[ \t]*/u.exec(text.slice(r.start, r.end))?.[0] ?? "";
}

/** 行範囲群でブロックの開閉が閉じている (well-nested) かを判定する */
function isBalanced(text: string, lines: readonly SourceRange[]): boolean {
  let depth = 0;
  for (const r of lines) {
    const line = text.slice(r.start, r.end);
    if (/^\s*(?:loop|alt|opt|par)\b/.test(line)) depth++;
    else if (/^\s*end\s*$/.test(line)) {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}
