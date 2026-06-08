import type { SourceRange, TextEdit } from "./types";

// 構造編集: 新しい要素 (ノード / エッジ) をテキストへ追加する。
// 既存範囲を変更しないゼロ幅挿入として表現し、戦略 B と整合させる。

export const INDENT = "  ";

/** 既存 ID と衝突しない新しい ID (prefix1, prefix2, ...) を返す */
export function freshNodeId(existing: Iterable<string>, prefix = "n"): string {
  const set = new Set(existing);
  for (let k = 1; ; k++) {
    const id = `${prefix}${k}`;
    if (!set.has(id)) return id;
  }
}

/**
 * 文末 (末尾空白を除く最後の内容の直後) に 1 文を追加する TextEdit を返す。
 * 既存の末尾空白はそのまま新文の後ろに残るため、整形を保ったまま追記できる。
 */
export function appendStatement(text: string, statement: string): TextEdit {
  const end = text.replace(/\s+$/u, "").length;
  return { range: { start: end, end }, newText: `\n${INDENT}${statement}` };
}

/**
 * 指定行の前 ("before") / 後 ("after") に 1 文を挿入する TextEdit を返す。
 * 既存行のインデントに合わせる (ゼロ幅挿入なので戦略 B と整合する)。
 */
export function insertStatement(
  text: string,
  lineRange: TextEdit["range"],
  where: "before" | "after",
  statement: string,
): TextEdit {
  const line = text.slice(lineRange.start, lineRange.end);
  const indent = /^[ \t]*/u.exec(line)?.[0] ?? INDENT;
  return where === "after"
    ? { range: { start: lineRange.end, end: lineRange.end }, newText: `\n${indent}${statement}` }
    : { range: { start: lineRange.start, end: lineRange.start }, newText: `${indent}${statement}\n` };
}

const DIRECTIONS = ["TD", "LR", "RL", "BT"] as const;
const DIR_RE = /^(\s*)(flowchart|graph)([ \t]*)(TB|TD|BT|RL|LR)?/d;

/** ヘッダ行の現在の方向を返す (無指定は TD 扱い) */
export function currentDirection(text: string): string {
  const { line } = headerLine(text);
  const m = DIR_RE.exec(line);
  return m?.[4] ?? "TD";
}

/** 現在の方向から次の方向 (TD→LR→RL→BT→TD) へ切り替える TextEdit を返す */
export function cycleDirectionEdit(text: string): TextEdit | null {
  const { line, start } = headerLine(text);
  const m = DIR_RE.exec(line);
  if (!m?.indices) return null;
  const cur = m[4] ?? "TD";
  const next = DIRECTIONS[(DIRECTIONS.indexOf(cur as (typeof DIRECTIONS)[number]) + 1) % DIRECTIONS.length];
  if (m.indices[4]) {
    const [s, e] = m.indices[4];
    return { range: { start: start + s, end: start + e }, newText: next };
  }
  // 方向未指定ならキーワード直後に挿入する
  const [, ke] = m.indices[2]!;
  return { range: { start: start + ke, end: start + ke }, newText: ` ${next}` };
}

/** コメント・空行を除く最初の行とその開始オフセットを返す */
function headerLine(text: string): { line: string; start: number } {
  let start = 0;
  for (const raw of text.split("\n")) {
    if (raw.trim() && !raw.trim().startsWith("%%")) {
      const end = text.indexOf("\n", start);
      return { line: end === -1 ? text.slice(start) : text.slice(start, end), start };
    }
    start += raw.length + 1;
  }
  return { line: "", start: 0 };
}

/**
 * 指定した行範囲群 (とそれぞれの改行) を削除する TextEdit 群を返す。
 *
 * 各行は本体 + 末尾改行 (無ければ直前の改行) を削除対象とする。隣接行の削除で
 * 範囲が重なっても破綻しないよう、削除対象の文字位置を集合化してから連続する
 * 範囲へまとめ直す。これにより applyEdits の重なり制約を常に満たす。
 */
export function deleteLines(text: string, lineRanges: readonly TextEdit["range"][]): TextEdit[] {
  const remove = new Set<number>();
  for (const { start, end } of lineRanges) {
    for (let k = start; k < end; k++) remove.add(k);
    if (text[end] === "\n") remove.add(end);
    else if (start > 0 && text[start - 1] === "\n") remove.add(start - 1);
  }

  const positions = [...remove].sort((a, b) => a - b);
  const edits: TextEdit[] = [];
  for (let i = 0; i < positions.length; ) {
    const start = positions[i];
    let end = start;
    while (i < positions.length && positions[i] === end) {
      end++;
      i++;
    }
    edits.push({ range: { start, end }, newText: "" });
  }
  return edits;
}

/** テキスト全行の範囲 (改行は含まない) を文書順で返す */
export function allLineRanges(text: string): SourceRange[] {
  const ranges: SourceRange[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    ranges.push({ start: offset, end: offset + line.length });
    offset += line.length + 1;
  }
  return ranges;
}

const PARTICIPANT_RE = /^\s*(?:participant|actor)\b/;

/**
 * 新しい participant/actor 宣言を、既存の宣言群の直後へ挿入する TextEdit を返す。
 * 宣言が無ければ図ヘッダ (最初の有意行) の直後、それも無ければ文末へ追記する。
 * 宣言を上にまとめることで、メッセージの間に紛れ込まない。
 */
export function participantInsertEdit(text: string, statement: string): TextEdit {
  let anchor: SourceRange | null = null;
  let header: SourceRange | null = null;
  for (const r of allLineRanges(text)) {
    const line = text.slice(r.start, r.end);
    const t = line.trim();
    if (!header && t !== "" && !t.startsWith("%%")) header = r;
    if (PARTICIPANT_RE.test(line)) anchor = r;
  }
  if (anchor) return insertStatement(text, anchor, "after", statement);
  // 宣言が無い場合はヘッダ直後へ。ヘッダ自身は無インデントなので本文インデントを使う
  if (header) return { range: { start: header.end, end: header.end }, newText: `\n${INDENT}${statement}` };
  return appendStatement(text, statement);
}

/**
 * 指定行を 1 行上 ("up") / 下 ("down") の行と入れ替える TextEdit 群を返す。
 * 各行のテキスト (インデント込み) ごと入れ替えるため、文の並び順だけが変わる。
 * 範囲外、または図ヘッダ (最初の有意行) より上へ動かす場合は null を返す。
 */
export function moveLineEdit(text: string, lineRange: SourceRange, dir: "up" | "down"): TextEdit[] | null {
  const lines = allLineRanges(text);
  const idx = lines.findIndex((r) => r.start <= lineRange.start && lineRange.start <= r.end);
  if (idx === -1) return null;
  const j = dir === "up" ? idx - 1 : idx + 1;
  if (j < 0 || j >= lines.length) return null;
  const headerIdx = lines.findIndex((r) => {
    const t = text.slice(r.start, r.end).trim();
    return t !== "" && !t.startsWith("%%");
  });
  if (idx <= headerIdx) return null; // ヘッダ自身は動かさない
  if (dir === "up" && j <= headerIdx) return null; // ヘッダの上には出さない
  const a = lines[idx];
  const b = lines[j];
  return [
    { range: a, newText: text.slice(b.start, b.end) },
    { range: b, newText: text.slice(a.start, a.end) },
  ];
}
