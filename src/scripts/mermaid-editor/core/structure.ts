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
 * indentOverride を与えると、行のインデントでなくその値を使う
 * (ブロックヘッダ/分岐の直後へ「本文として」挿入する場合など)。
 */
export function insertStatement(
  text: string,
  lineRange: TextEdit["range"],
  where: "before" | "after",
  statement: string,
  indentOverride?: string,
): TextEdit {
  const line = text.slice(lineRange.start, lineRange.end);
  const indent = indentOverride ?? (/^[ \t]*/u.exec(line)?.[0] ?? INDENT);
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

/** 先頭の YAML フロントマター (--- ... ---) の本体開始行 index を返す (無ければ 0) */
function bodyStartLine(lines: readonly string[]): number {
  const first = lines.findIndex((l) => l.trim() !== "");
  if (first === -1 || lines[first].trim() !== "---") return 0;
  for (let k = first + 1; k < lines.length; k++) {
    if (lines[k].trim() === "---") return k + 1; // 閉じ --- の次が本体
  }
  return lines.length; // 閉じが無ければ全行フロントマター扱い
}

/**
 * 図ヘッダ (フロントマター・コメント・空行を除く最初の有意行) の行 index を返す。
 * allLineRanges と同じ split 基準なので、その index で行範囲を引ける。無ければ -1。
 */
export function headerLineIndex(text: string): number {
  const lines = text.split("\n");
  for (let i = bodyStartLine(lines); i < lines.length; i++) {
    const t = lines[i].trim();
    if (t !== "" && !t.startsWith("%%")) return i;
  }
  return -1;
}

/** 図ヘッダ行 (フロントマターを除く最初の有意行) とその開始オフセットを返す */
function headerLine(text: string): { line: string; start: number } {
  const idx = headerLineIndex(text);
  if (idx === -1) return { line: "", start: 0 };
  const r = allLineRanges(text)[idx];
  return { line: text.slice(r.start, r.end), start: r.start };
}

/**
 * 先頭の YAML フロントマター内の `title: <値>` を返す (無ければ null)。
 * 値のソース範囲を編集対象にする (図種非依存)。
 */
export function parseTitle(text: string): { value: string; range: SourceRange } | null {
  const lines = allLineRanges(text);
  const first = lines.findIndex((r) => text.slice(r.start, r.end).trim() !== "");
  if (first === -1 || text.slice(lines[first].start, lines[first].end).trim() !== "---") return null;
  for (let k = first + 1; k < lines.length; k++) {
    const r = lines[k];
    const line = text.slice(r.start, r.end);
    if (line.trim() === "---") break; // フロントマター終端
    const m = /^(\s*title:[ \t]*)(.+?)[ \t]*$/u.exec(line);
    if (m) {
      const start = r.start + m[1].length;
      return { value: m[2], range: { start, end: start + m[2].length } };
    }
  }
  return null;
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

/** 指定オフセットを含む行の範囲を返す (無ければ undefined) */
export function lineRangeAt(text: string, offset: number): SourceRange | undefined {
  return allLineRanges(text).find((r) => r.start <= offset && offset <= r.end);
}

const AUTONUMBER_RE = /^\s*autonumber\b/u;

/**
 * sequenceDiagram の autonumber を切り替える TextEdit を返す。
 * 既にあれば全ての autonumber 行を削除 (解除)、無ければ図ヘッダ直後へ挿入 (有効化)。
 * 挿入インデントは本文 (ヘッダ次の有意行) に合わせる。
 */
export function toggleAutonumberEdits(text: string): TextEdit[] {
  const lines = allLineRanges(text);
  const existing = lines.filter((r) => AUTONUMBER_RE.test(text.slice(r.start, r.end)));
  if (existing.length > 0) return deleteLines(text, existing); // 解除
  const headerIdx = headerLineIndex(text);
  if (headerIdx === -1) return [];
  let indent = INDENT;
  for (let k = headerIdx + 1; k < lines.length; k++) {
    const t = text.slice(lines[k].start, lines[k].end);
    if (t.trim() !== "") {
      indent = /^[ \t]*/u.exec(t)?.[0] ?? INDENT;
      break;
    }
  }
  return [insertStatement(text, lines[headerIdx], "after", "autonumber", indent)];
}

const PARTICIPANT_RE = /^\s*(?:participant|actor)\b/;

/**
 * 新しい participant/actor 宣言を、既存の宣言群の直後へ挿入する TextEdit を返す。
 * 宣言が無ければ図ヘッダ (最初の有意行) の直後、それも無ければ文末へ追記する。
 * 宣言を上にまとめることで、メッセージの間に紛れ込まない。
 */
export function participantInsertEdit(text: string, statement: string): TextEdit {
  const lines = allLineRanges(text);
  const headerIdx = headerLineIndex(text);
  let anchor: SourceRange | null = null;
  for (const r of lines) {
    if (PARTICIPANT_RE.test(text.slice(r.start, r.end))) anchor = r;
  }
  if (anchor) return insertStatement(text, anchor, "after", statement);
  // 宣言が無い場合はヘッダ (フロントマターを除く) 直後へ。本文インデントを使う
  const header = headerIdx === -1 ? null : lines[headerIdx];
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
  const headerIdx = headerLineIndex(text);
  if (idx <= headerIdx) return null; // ヘッダ自身 (やフロントマター) は動かさない
  if (dir === "up" && j <= headerIdx) return null; // ヘッダの上には出さない
  const a = lines[idx];
  const b = lines[j];
  return [
    { range: a, newText: text.slice(b.start, b.end) },
    { range: b, newText: text.slice(a.start, a.end) },
  ];
}
