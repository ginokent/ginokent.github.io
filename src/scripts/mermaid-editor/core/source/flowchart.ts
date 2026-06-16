import type { EdgeLabelToken, EdgeToken, NodeToken, SourceRange, TextEdit } from "../types";
import { allLineRanges, appendStatement, headerLineIndex, INDENT, insertStatement } from "../structure";

// ソースモデル層 (フローチャート)
//
// Mermaid のパーサはソース位置を返さないため、テキストを自前で 1 パス走査して
// 各論理要素のテキスト範囲を算出する。本層は「意味解析」ではなく「位置特定」に徹する。
//
// 検出するもの:
//   - ノード宣言   A[...] / A(...) 等         → ラベルと ID 出現範囲
//   - エッジラベル |...|                       → ラベル範囲
//   - エッジ       A --> B                     → from/to 範囲・行範囲
// スキップするもの: コメント (%% ...)・ラベル括弧内・エッジラベル

/** ノード形状の開き括弧 → 閉じ括弧。長いものから順に試す必要がある */
const SHAPES: ReadonlyArray<readonly [open: string, close: string]> = [
  ["([", "])"],
  ["((", "))"],
  ["[[", "]]"],
  ["[(", ")]"],
  ["{{", "}}"],
  ["[", "]"],
  ["(", ")"],
  ["{", "}"],
  [">", "]"],
];

/** リンク (矢印) を構成する文字 */
const LINK_CHARS = new Set("-.=<>xo".split(""));
/** リンクの開始になり得る文字 */
const LINK_START = new Set("-=<".split(""));

export interface FlowchartTokens {
  nodes: NodeToken[];
  edgeLabels: EdgeLabelToken[];
  edges: EdgeToken[];
}

function isIdChar(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}

// unquoted のラベルに含まれると mermaid の parse が壊れる文字。
// () [] {} は形状括弧、| はエッジラベル区切り、" は引用符、@ は v11 の @{} 形状構文。
// これらを含むラベルは書き戻し時に "..." で囲む (quoteFlowchartLabel)。
const NEEDS_QUOTE = /[()[\]{}|"@]/u;

/** ラベルの素値を flowchart 記法へ整形する。特殊文字を含むときだけ引用符で囲む */
export function quoteFlowchartLabel(value: string): string {
  if (!NEEDS_QUOTE.test(value)) return value;
  return `"${value.replace(/"/gu, "&quot;")}"`;
}

/** 括弧内のラベル領域 (引用符を含み得る) から素の値を取り出す */
export function unquoteFlowchartLabel(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/&quot;/giu, '"');
  }
  return raw;
}

export function tokenizeFlowchart(text: string): FlowchartTokens {
  const occurrences = new Map<string, SourceRange[]>();
  const decls = new Map<
    string,
    { label: string; labelRange: SourceRange; shapeOpen: SourceRange; shapeClose: SourceRange }
  >();
  const order: string[] = [];
  const edgeLabels: EdgeLabelToken[] = [];
  const edges: EdgeToken[] = [];
  const pairCount = new Map<string, number>();

  // エッジ検出のための状態 (文ごとにリセット)
  let lastNode: { id: string; range: SourceRange; refRange: SourceRange } | null = null;
  let pendingLink = false;
  let pendingLinkRange: SourceRange | null = null;
  let pendingLabel: { value: string; range: SourceRange } | null = null;
  const resetStatement = () => {
    lastNode = null;
    pendingLink = false;
    pendingLinkRange = null;
    pendingLabel = null;
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    // 文の区切りでエッジ状態をリセットする
    if (ch === "\n" || ch === ";") {
      resetStatement();
      i++;
      continue;
    }

    // コメント (%% ...) は行末まで読み飛ばす (改行は次反復で処理)
    if (ch === "%" && text[i + 1] === "%") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }

    // エッジラベル (|...|)
    if (ch === "|") {
      const close = findClose(text, i + 1, "|");
      if (close !== -1) {
        // 範囲は区切り | の内側全体 (引用符があれば含む)。値は素値へ戻す
        const range: SourceRange = { start: i + 1, end: close };
        const value = unquoteFlowchartLabel(text.slice(range.start, range.end));
        edgeLabels.push({ label: value, labelRange: range });
        if (pendingLink) pendingLabel = { value, range };
        i = close + 1;
        continue;
      }
    }

    // リンク (矢印)
    if (LINK_START.has(ch)) {
      let k = i;
      while (k < text.length && LINK_CHARS.has(text[k])) k++;
      if (k - i >= 2) {
        if (lastNode) {
          pendingLink = true;
          pendingLinkRange = { start: i, end: k };
        }
        i = k;
        continue;
      }
    }

    // 識別子の先頭か (直前が識別子文字でない = 語境界)
    const prev = i > 0 ? text[i - 1] : "";
    if (!isIdChar(ch) || isIdChar(prev)) {
      i++;
      continue;
    }

    // 識別子を読み取り、出現を記録する
    let j = i;
    while (j < text.length && isIdChar(text[j])) j++;
    const id = text.slice(i, j);
    const idRange: SourceRange = { start: i, end: j };
    pushRange(occurrences, id, idRange);

    // 直後に開き括弧があればラベル付きノード宣言。
    // ノード参照の終端 (id + 形状) を求め、向き反転で参照ごと入れ替えられるようにする。
    let refEnd = j;
    const shape = matchShape(text, j);
    if (shape) {
      const labelStart = j + shape.open.length;
      const closeAt = findClose(text, labelStart, shape.close);
      if (closeAt !== -1) {
        if (!decls.has(id)) {
          // ラベル範囲は括弧の内側全体 (引用符があれば含む)。書き戻し時に
          // quoteFlowchartLabel で必要に応じ引用符を付け直すため、範囲ごと置換する
          const range: SourceRange = { start: labelStart, end: closeAt };
          decls.set(id, {
            label: unquoteFlowchartLabel(text.slice(range.start, range.end)),
            labelRange: range,
            shapeOpen: { start: j, end: labelStart },
            shapeClose: { start: closeAt, end: closeAt + shape.close.length },
          });
          order.push(id);
        }
        refEnd = closeAt + shape.close.length;
      }
    }
    const refRange: SourceRange = { start: i, end: refEnd };

    // 直前にリンクがあればエッジを確定する (始点/終点は id 範囲と参照範囲の両方を持つ)
    if (pendingLink && lastNode) {
      const key = `${lastNode.id} ${id}`;
      const index = pairCount.get(key) ?? 0;
      pairCount.set(key, index + 1);
      edges.push({
        fromId: lastNode.id,
        fromRange: lastNode.range,
        fromRefRange: lastNode.refRange,
        toId: id,
        toRange: idRange,
        toRefRange: refRange,
        index,
        linkRange: pendingLinkRange ?? { start: lastNode.range.end, end: idRange.start },
        statementRange: lineSpan(text, lastNode.refRange.start, refEnd),
        label: pendingLabel ?? undefined,
      });
      pendingLink = false;
      pendingLinkRange = null;
      pendingLabel = null;
    }
    lastNode = { id, range: idRange, refRange };
    i = refEnd;
  }

  const nodes: NodeToken[] = order.map((id) => {
    const d = decls.get(id)!;
    const occ = occurrences.get(id) ?? [];
    return {
      id,
      label: d.label,
      labelRange: d.labelRange,
      idRanges: occ,
      removeLines: uniqueLineSpans(text, occ),
      shapeOpen: d.shapeOpen,
      shapeClose: d.shapeClose,
    };
  });
  return { nodes, edgeLabels, edges };
}

function matchShape(text: string, pos: number): { open: string; close: string } | null {
  for (const [open, close] of SHAPES) {
    if (text.startsWith(open, pos)) return { open, close };
  }
  return null;
}

function findClose(text: string, start: number, close: string): number {
  if (text[start] === '"') {
    const q = text.indexOf('"', start + 1);
    if (q === -1) return -1;
    return text.indexOf(close, q + 1);
  }
  return text.indexOf(close, start);
}

/** オフセット a を含む行頭から、b を含む行末 (改行の手前) までの範囲 */
function lineSpan(text: string, a: number, b: number): SourceRange {
  let s = a;
  while (s > 0 && text[s - 1] !== "\n") s--;
  let e = b;
  while (e < text.length && text[e] !== "\n") e++;
  return { start: s, end: e };
}

/** 各範囲を含む行範囲へ写像し、開始位置で重複を除く */
function uniqueLineSpans(text: string, ranges: readonly SourceRange[]): SourceRange[] {
  const byStart = new Map<number, SourceRange>();
  for (const r of ranges) {
    const span = lineSpan(text, r.start, r.end);
    if (!byStart.has(span.start)) byStart.set(span.start, span);
  }
  return [...byStart.values()];
}

function pushRange(map: Map<string, SourceRange[]>, key: string, range: SourceRange): void {
  const arr = map.get(key);
  if (arr) arr.push(range);
  else map.set(key, [range]);
}

/**
 * 新しいノード宣言を「宣言ブロック」の末尾へ挿入する TextEdit を返す。
 *
 * 宣言ブロック = 先頭付近の「純粋なノード宣言行」(ノード宣言を含み、矢印を含まない行)。
 * その最後の行の直後へ挿入する。これにより「宣言は上にまとめ、矢印は下に書く」流儀
 * (ユーザー要望) を維持できる。純粋宣言行が無ければヘッダ直後、ヘッダも無ければ文末へ。
 *
 * 行の判定はトークナイザ結果で行う (ラベル内の `--` 等を矢印と誤認しないため):
 * ノード宣言の開き括弧がある行のうち、どのエッジの statementRange にも含まれない行が
 * 「純粋なノード宣言行」である。
 */
export function flowchartDeclInsertEdit(text: string, statement: string): TextEdit {
  const { nodes, edges } = tokenizeFlowchart(text);
  const lines = allLineRanges(text);
  const lineOf = (offset: number) => lines.findIndex((r) => offset >= r.start && offset <= r.end);

  // 矢印 (エッジ) が占める行を集める。これらの行のノード宣言はインライン宣言なので除外する
  const edgeLines = new Set<number>();
  for (const e of edges) {
    const from = lineOf(e.statementRange.start);
    const to = lineOf(e.statementRange.end);
    for (let i = from; i <= to; i++) edgeLines.add(i);
  }

  // 純粋なノード宣言行のうち最も下の行をアンカーにする
  let anchorIdx = -1;
  for (const n of nodes) {
    const li = lineOf(n.shapeOpen.start);
    if (li >= 0 && !edgeLines.has(li)) anchorIdx = Math.max(anchorIdx, li);
  }
  if (anchorIdx >= 0) return insertStatement(text, lines[anchorIdx], "after", statement);

  // 宣言行が無ければヘッダ直後へ (本文インデント)。ヘッダも無ければ文末へ
  const headerIdx = headerLineIndex(text);
  if (headerIdx >= 0) {
    const h = lines[headerIdx];
    return { range: { start: h.end, end: h.end }, newText: `\n${INDENT}${statement}` };
  }
  return appendStatement(text, statement);
}
