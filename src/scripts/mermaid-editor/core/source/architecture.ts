import type {
  ArchEdgeToken,
  ArchLinkKind,
  ArchNodeKind,
  ArchNodeToken,
  ArchSide,
  SourceRange,
  TextEdit,
} from "../types";
import { INDENT, appendStatement, headerLineIndex } from "../structure";

// ソースモデル層 (architecture-beta)
//
// architecture-beta は 1 行 = 1 文の line-based 文法。
//   - `service <id>[(<icon>)][[<label>]][ in <parent>]`
//   - `group   <id>[(<icon>)][[<label>]][ in <parent>]`
//   - `junction <id>[ in <parent>]`
//   - エッジ:  `<from>:<T|B|L|R> <-->|-->|--> <T|B|L|R>:<to>`
// スキップ: 空行 / コメント (%% …) / YAML frontmatter / `architecture-beta` ヘッダ
//
// Mermaid のパーサはソース位置を返さないため、テキストを行単位に走査して各要素の
// テキスト範囲を算出する。本層は「意味解析」ではなく「位置特定」に徹する
// (edge の linkKind は編集時に別記法へ切替する必要があるため属性化してある)。

/** ラベル / アイコン / エッジで意味を持つ文字を除いた ID 文字 */
const ID_RE = /^[A-Za-z_][A-Za-z0-9_]*/u;
const SIDE_RE = /^[TBLR]/u;
/** リンク演算子: `-->` (矢印付き) と `--` (線のみ) の 2 種のみをサポートする */
const LINK_RE = /^(-->|--)/u;
/** アーキ図のキーワード行 (先頭 3 語) */
const DECL_RE = /^(service|group|junction)\s+/u;
/** in 節 (末尾) */
const IN_RE = /\s+in\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/u;

export interface ArchitectureTokens {
  nodes: ArchNodeToken[];
  edges: ArchEdgeToken[];
}

/** 半開区間 [start, end) */
const range = (start: number, end: number): SourceRange => ({ start, end });

/** テキストの `\n` 区切りで各行の [start, end) を返す (改行を含まない) */
function lineRanges(text: string): SourceRange[] {
  const out: SourceRange[] = [];
  let s = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      out.push(range(s, i));
      s = i + 1;
    }
  }
  out.push(range(s, text.length));
  return out;
}

/**
 * YAML frontmatter (--- ... ---) の行番号帯を返す (無ければ空)。
 * トークナイザは frontmatter 行を無視する必要がある (図種判定・ヘッダ行検出も同様)。
 */
function frontmatterLineIndices(text: string, lines: readonly SourceRange[]): Set<number> {
  const skip = new Set<number>();
  const first = lines.findIndex((r) => text.slice(r.start, r.end).trim() !== "");
  if (first === -1) return skip;
  if (text.slice(lines[first].start, lines[first].end).trim() !== "---") return skip;
  skip.add(first);
  for (let i = first + 1; i < lines.length; i++) {
    skip.add(i);
    if (text.slice(lines[i].start, lines[i].end).trim() === "---") return skip;
  }
  return skip; // 閉じ --- が無い場合は最終行まで無視する
}

/**
 * `(icon)` を line 内オフセット `at` から検出する。開き括弧が見つからなければ null。
 * 括弧内側は素値と範囲、外側全体の範囲を返す。
 */
function parseParen(line: string, at: number): { open: number; close: number } | null {
  if (line[at] !== "(") return null;
  const close = line.indexOf(")", at + 1);
  if (close === -1) return null;
  return { open: at, close };
}

/**
 * `[label]` を line 内オフセット `at` から検出する。開き括弧が見つからなければ null。
 * ネストや引用符は architecture-beta のラベルには無いため、単純に最初の `]` までを取る。
 */
function parseBracket(line: string, at: number): { open: number; close: number } | null {
  if (line[at] !== "[") return null;
  const close = line.indexOf("]", at + 1);
  if (close === -1) return null;
  return { open: at, close };
}

/** 空白文字 (半角スペース・タブ) を読み飛ばす */
function skipSpaces(line: string, at: number): number {
  while (at < line.length && (line[at] === " " || line[at] === "\t")) at++;
  return at;
}

/**
 * 1 行を宣言 (service/group/junction) としてパースする。行内のオフセットは
 * 行の先頭 (`lineStart`) を足して絶対オフセットへ戻す。宣言でなければ null。
 */
function parseDeclLine(
  text: string,
  line: SourceRange,
): {
  kind: ArchNodeKind;
  id: string;
  idRange: SourceRange;
  icon: string;
  iconRange: SourceRange | null;
  iconParenRange: SourceRange | null;
  label: string;
  labelRange: SourceRange | null;
  labelBracketRange: SourceRange | null;
  parent: string | null;
  parentRange: SourceRange | null;
  inClauseRange: SourceRange | null;
  afterIdEnd: number;
} | null {
  const raw = text.slice(line.start, line.end);
  // 前置空白を消費して残りを走査 (以降 pos は絶対オフセット)
  const bodyStart = line.start + (raw.length - raw.trimStart().length);
  const kw = text.slice(bodyStart).match(DECL_RE);
  if (!kw) return null;
  const kind = kw[1] as ArchNodeKind;
  let pos = bodyStart + kw[0].length;
  // id
  const idMatch = text.slice(pos, line.end).match(ID_RE);
  if (!idMatch) return null;
  const id = idMatch[0];
  const idRange = range(pos, pos + id.length);
  pos = idRange.end;
  const afterIdEnd = pos;

  // 続くトークン (icon → label → in) を任意順で拾う (実装は文法どおり順序固定)
  let icon = "";
  let iconRange: SourceRange | null = null;
  let iconParenRange: SourceRange | null = null;
  let label = "";
  let labelRange: SourceRange | null = null;
  let labelBracketRange: SourceRange | null = null;

  // (icon)
  const paren = parseParen(text, pos);
  if (paren && paren.close <= line.end) {
    icon = text.slice(paren.open + 1, paren.close);
    iconRange = range(paren.open + 1, paren.close);
    iconParenRange = range(paren.open, paren.close + 1);
    pos = paren.close + 1;
  }
  // [label]
  const bracket = parseBracket(text, pos);
  if (bracket && bracket.close <= line.end) {
    label = text.slice(bracket.open + 1, bracket.close);
    labelRange = range(bracket.open + 1, bracket.close);
    labelBracketRange = range(bracket.open, bracket.close + 1);
    pos = bracket.close + 1;
  }
  // in <parent> (末尾)
  let parent: string | null = null;
  let parentRange: SourceRange | null = null;
  let inClauseRange: SourceRange | null = null;
  const tail = text.slice(pos, line.end);
  const inM = tail.match(IN_RE);
  if (inM) {
    parent = inM[1];
    // inM.index は tail 内のマッチ開始位置 (先頭空白を含む)。絶対オフセットへ戻す
    const inStart = pos + (inM.index ?? 0);
    const inEnd = pos + tail.length; // 行末まで (末尾空白は消費される)
    inClauseRange = range(inStart, inEnd);
    // parent id の範囲は inM[1] の位置 (先頭空白 + "in" + 空白の後)
    const parentStart = inStart + inM[0].lastIndexOf(parent);
    parentRange = range(parentStart, parentStart + parent.length);
  }

  return {
    kind,
    id,
    idRange,
    icon,
    iconRange,
    iconParenRange,
    label,
    labelRange,
    labelBracketRange,
    parent,
    parentRange,
    inClauseRange,
    afterIdEnd,
  };
}

/**
 * 1 行をエッジ (`from:S <op> S:to`) としてパースする。エッジでなければ null。
 * 演算子の左右で side/id を対称に検出する。線種は演算子文字列から判定する。
 */
function parseEdgeLine(
  text: string,
  line: SourceRange,
): {
  fromId: string;
  fromRange: SourceRange;
  fromSide: ArchSide;
  fromSideRange: SourceRange;
  toId: string;
  toRange: SourceRange;
  toSide: ArchSide;
  toSideRange: SourceRange;
  linkKind: ArchLinkKind;
  linkRange: SourceRange;
} | null {
  const raw = text.slice(line.start, line.end);
  const bodyStart = line.start + (raw.length - raw.trimStart().length);
  // from id
  const idM = text.slice(bodyStart, line.end).match(ID_RE);
  if (!idM) return null;
  let pos = bodyStart + idM[0].length;
  if (text[pos] !== ":") return null;
  pos++;
  // from side (1 文字)
  const sm1 = text.slice(pos, line.end).match(SIDE_RE);
  if (!sm1) return null;
  const fromSideRange = range(pos, pos + 1);
  pos += 1;
  pos = skipSpaces(text, pos);
  // 演算子
  const linkM = text.slice(pos, line.end).match(LINK_RE);
  if (!linkM) return null;
  const linkRange = range(pos, pos + linkM[0].length);
  pos += linkM[0].length;
  pos = skipSpaces(text, pos);
  // to side
  const sm2 = text.slice(pos, line.end).match(SIDE_RE);
  if (!sm2) return null;
  const toSideRange = range(pos, pos + 1);
  pos += 1;
  if (text[pos] !== ":") return null;
  pos++;
  // to id
  const idM2 = text.slice(pos, line.end).match(ID_RE);
  if (!idM2) return null;
  const toRange = range(pos, pos + idM2[0].length);
  pos += idM2[0].length;
  // 行末は空白のみ許容 (残りが非空白ならエッジ行と判断しない)
  const tail = text.slice(pos, line.end);
  if (tail.trim() !== "") return null;
  return {
    fromId: idM[0],
    fromRange: range(bodyStart, bodyStart + idM[0].length),
    fromSide: sm1[0] as ArchSide,
    fromSideRange,
    toId: idM2[0],
    toRange,
    toSide: sm2[0] as ArchSide,
    toSideRange,
    linkKind: linkM[0] === "-->" ? "arrow" : "line",
    linkRange,
  };
}

/**
 * architecture-beta のテキストを走査し、宣言 (ArchNodeToken) とエッジ (ArchEdgeToken) を返す。
 *
 * 手順:
 *   1. 行を走査して宣言 / エッジをまず全て parse し、id の出現範囲を集める
 *   2. 宣言ごとの `ArchNodeToken` を組み立てる (idRanges, removeLines を後付け)
 *   3. エッジは同一 from→to 内で通し番号を振って ArchEdgeToken を組み立てる
 */
export function tokenizeArchitecture(text: string): ArchitectureTokens {
  const lines = lineRanges(text);
  const skip = frontmatterLineIndices(text, lines);
  const decls: ReturnType<typeof parseDeclLine>[] = [];
  const declLineOf: SourceRange[] = []; // 宣言と 1:1 対応する行範囲
  const edgesParsed: Array<{ line: SourceRange; parsed: NonNullable<ReturnType<typeof parseEdgeLine>> }> = [];

  // 1. 行ごとに宣言 / エッジを分類する
  for (let i = 0; i < lines.length; i++) {
    if (skip.has(i)) continue;
    const line = lines[i];
    const trimmed = text.slice(line.start, line.end).trim();
    if (!trimmed || trimmed.startsWith("%%")) continue;
    // ヘッダ行 (`architecture-beta`) 等は宣言でもエッジでもないので自然にスキップされる
    const d = parseDeclLine(text, line);
    if (d) {
      decls.push(d);
      declLineOf.push(line);
      continue;
    }
    const e = parseEdgeLine(text, line);
    if (e) edgesParsed.push({ line, parsed: e });
  }

  // 2. id の出現範囲を集める (宣言の id + in <parent> の parent + エッジの from/to)
  const occurrences = new Map<string, SourceRange[]>();
  const push = (id: string, r: SourceRange) => {
    const arr = occurrences.get(id);
    if (arr) arr.push(r);
    else occurrences.set(id, [r]);
  };
  for (const d of decls) {
    if (!d) continue;
    push(d.id, d.idRange);
    if (d.parent && d.parentRange) push(d.parent, d.parentRange);
  }
  for (const { parsed: e } of edgesParsed) {
    push(e.fromId, e.fromRange);
    push(e.toId, e.toRange);
  }

  // 3. 各 id を参照するエッジ行を集める (カスケード削除用)
  const edgeLinesOf = new Map<string, SourceRange[]>();
  for (const { line, parsed } of edgesParsed) {
    for (const id of new Set([parsed.fromId, parsed.toId])) {
      const arr = edgeLinesOf.get(id);
      if (arr) arr.push(line);
      else edgeLinesOf.set(id, [line]);
    }
  }

  const nodes: ArchNodeToken[] = decls.filter((d): d is NonNullable<typeof d> => d !== null).map((d, i) => ({
    id: d.id,
    kind: d.kind,
    label: d.label,
    labelRange: d.labelRange,
    labelBracketRange: d.labelBracketRange,
    icon: d.icon,
    iconRange: d.iconRange,
    iconParenRange: d.iconParenRange,
    parent: d.parent,
    parentRange: d.parentRange,
    inClauseRange: d.inClauseRange,
    afterIdEnd: d.afterIdEnd,
    idRanges: occurrences.get(d.id) ?? [d.idRange],
    declLineRange: declLineOf[i],
    // カスケード削除: 自宣言行 + 参照するエッジ行 (重複除去)
    removeLines: dedupeLines([declLineOf[i], ...(edgeLinesOf.get(d.id) ?? [])]),
  }));

  // 同一 from→to の通し番号を振る
  const pairCount = new Map<string, number>();
  const edges: ArchEdgeToken[] = edgesParsed.map(({ line, parsed: e }) => {
    const key = `${e.fromId} ${e.toId}`;
    const index = pairCount.get(key) ?? 0;
    pairCount.set(key, index + 1);
    return {
      fromId: e.fromId,
      fromRange: e.fromRange,
      fromSide: e.fromSide,
      fromSideRange: e.fromSideRange,
      toId: e.toId,
      toRange: e.toRange,
      toSide: e.toSide,
      toSideRange: e.toSideRange,
      linkKind: e.linkKind,
      linkRange: e.linkRange,
      index,
      statementRange: line,
    };
  });

  return { nodes, edges };
}

/** 行範囲を start で重複除去する (カスケード削除で重複行を消さないため) */
function dedupeLines(lines: readonly SourceRange[]): SourceRange[] {
  const byStart = new Map<number, SourceRange>();
  for (const l of lines) if (!byStart.has(l.start)) byStart.set(l.start, l);
  return [...byStart.values()].sort((a, b) => a.start - b.start);
}

// ---- 編集用ヘルパ (architecture-beta) ----

/**
 * 宣言 (service / group / junction) の新規行を挿入する TextEdit を返す。
 *
 * 挿入位置は「宣言ブロック (先頭付近の宣言行の連続)」の末尾。エッジ (`from:s --> s:to`)
 * 行や空行の前に入れることで「宣言は上・エッジは下」のレイアウトを維持する。
 * 宣言行が無ければヘッダ (`architecture-beta`) 直後、ヘッダも無ければ文末へ。
 */
export function archDeclInsertEdit(text: string, statement: string): TextEdit {
  const { nodes, edges } = tokenizeArchitecture(text);
  const lines = lineRanges(text);
  const lineOf = (offset: number) => lines.findIndex((r) => offset >= r.start && offset <= r.end);
  const edgeLineIdx = new Set<number>();
  for (const e of edges) {
    const li = lineOf(e.statementRange.start);
    if (li >= 0) edgeLineIdx.add(li);
  }
  let anchorIdx = -1;
  for (const n of nodes) {
    const li = lineOf(n.declLineRange.start);
    if (li >= 0 && !edgeLineIdx.has(li)) anchorIdx = Math.max(anchorIdx, li);
  }
  if (anchorIdx >= 0) {
    const line = lines[anchorIdx];
    // 宣言行のインデントを踏襲して挿入する
    const indent = /^[ \t]*/u.exec(text.slice(line.start, line.end))?.[0] ?? INDENT;
    return { range: { start: line.end, end: line.end }, newText: `\n${indent}${statement}` };
  }
  const hIdx = headerLineIndex(text);
  if (hIdx >= 0) {
    const h = lines[hIdx];
    return { range: { start: h.end, end: h.end }, newText: `\n${INDENT}${statement}` };
  }
  return appendStatement(text, statement);
}

/**
 * ArchNodeToken への label 追加 (`[Label]`) を組み立てる TextEdit。
 * 挿入位置は icon がある場合は `)` の直後、無い場合は id 直後。
 */
export function archAddLabelEdit(node: ArchNodeToken, label: string): TextEdit | null {
  if (node.labelBracketRange) return null; // 既にラベル有りは呼ばれない想定
  const at = node.iconParenRange?.end ?? node.afterIdEnd;
  return { range: { start: at, end: at }, newText: `[${label}]` };
}

/**
 * ArchNodeToken への icon 追加 (`(icon)`) を組み立てる TextEdit。
 * 挿入位置は常に id 直後 (icon → label の順序を守るため、label より前に置く)。
 */
export function archAddIconEdit(node: ArchNodeToken, icon: string): TextEdit | null {
  if (node.iconParenRange) return null;
  const at = node.afterIdEnd;
  return { range: { start: at, end: at }, newText: `(${icon})` };
}

/**
 * ArchNodeToken の親 group を変更する TextEdits を返す。
 * - `parent === null` : `in <parent>` 句を除去 (無ければ no-op)
 * - 既存の `in <parent>` あり: parent 部分を置換
 * - `in` 句が無いのに parent 指定: 宣言行末に ` in <parent>` を追加
 */
export function archSetParentEdits(node: ArchNodeToken, parent: string | null): TextEdit[] {
  if (parent === null) {
    if (!node.inClauseRange) return [];
    return [{ range: node.inClauseRange, newText: "" }];
  }
  if (node.parentRange) {
    return [{ range: node.parentRange, newText: parent }];
  }
  const at = node.declLineRange.end;
  return [{ range: { start: at, end: at }, newText: ` in ${parent}` }];
}

/**
 * group を削除する TextEdits を返す (カスケード対応)。
 * 対象 group の宣言行を消し、子要素 (service / group / junction) の `in <group>` 句も併せて外す
 * (残ると mermaid が「in の親が存在しない」でパースエラーになるため)。
 * 対象 group を参照するエッジ行 (removeLines) も削除する。
 */
export function archRemoveGroupEdits(text: string, groupId: string): TextEdit[] {
  const { nodes } = tokenizeArchitecture(text);
  const target = nodes.find((n) => n.id === groupId && n.kind === "group");
  if (!target) return [];
  const edits: TextEdit[] = [];
  // 1. 宣言行を消す (統括的な removeLines は自宣言行 + 参照するエッジ行を含む)
  for (const r of target.removeLines) {
    // 行と改行 1 文字を消す (行末改行を含めるため end + 1)。ただし最終行は改行が無い
    const endInclNL = r.end < text.length && text[r.end] === "\n" ? r.end + 1 : r.end;
    edits.push({ range: { start: r.start, end: endInclNL }, newText: "" });
  }
  // 2. 子要素の in 句を消す (この group を親に持つ他ノード)
  for (const n of nodes) {
    if (n.parent === groupId && n.inClauseRange) {
      edits.push({ range: n.inClauseRange, newText: "" });
    }
  }
  return edits;
}
