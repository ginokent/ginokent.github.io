import type { SourceRange, SubgraphToken, TextEdit } from "../types";
import { allLineRanges, INDENT, insertStatement } from "../structure";
import { quoteFlowchartLabel, unquoteFlowchartLabel } from "./flowchart";

// ソースモデル層 (flowchart の subgraph)
//
// `subgraph <id>[<title>] … end` を行走査で解析し、タイトルの編集範囲・end 行の位置
// (ノードの割り当て挿入先)・cluster 相関用 ID を算出する。
//
// cluster 相関用 ID の規則 (mermaid v11 実測):
//   - `subgraph X` / `subgraph X[Title]` / `subgraph X [Title]` (X は単一識別子)
//       → ID = X (cluster の SVG id 末尾が `-X`)
//   - `subgraph 複数語タイトル` / `subgraph "..."` (識別子にならない)
//       → ID = `subGraph<文書順index>` (全 subgraph を出現順に 0,1,2… と採番)

const END_RE = /^\s*end\b\s*$/u;
const ID_HEAD = /^[A-Za-z0-9_]+/u;

interface OpenSub {
  index: number; // 文書順の通し番号 (自動 ID 用)
  headerRange: SourceRange;
  indent: string;
  id: string;
  title: string;
  titleRange: SourceRange;
  quoteTitle: boolean;
}

/** ヘッダ行の `subgraph` 以降 (rest) を解析する。restStart は rest の絶対オフセット */
function parseHeader(rest: string, restStart: number, index: number): Omit<OpenSub, "headerRange" | "indent"> {
  const autoId = `subGraph${index}`;
  const range = (s: number, e: number): SourceRange => ({ start: restStart + s, end: restStart + e });

  if (rest === "") {
    return { index, id: autoId, title: "", titleRange: range(0, 0), quoteTitle: false };
  }

  // 引用符付きタイトルのみ → 自動 ID、範囲は引用符の内側
  if (rest.startsWith('"')) {
    const close = rest.indexOf('"', 1);
    const end = close === -1 ? rest.length : close;
    return { index, id: autoId, title: rest.slice(1, end), titleRange: range(1, end), quoteTitle: false };
  }

  const idm = ID_HEAD.exec(rest);
  if (idm) {
    const id = idm[0];
    const tail = rest.slice(id.length); // ID の後ろ (未トリム)
    const after = tail.trimStart();
    const afterStart = id.length + (tail.length - after.length); // rest 内での after 開始位置
    // `X[Title]` / `X [Title]` → 明示 ID + 角括弧タイトル
    if (after.startsWith("[")) {
      const open = afterStart; // rest 内での '[' 位置
      const closeIdx = rest.lastIndexOf("]");
      if (closeIdx > open) {
        const inner = rest.slice(open + 1, closeIdx);
        return {
          index,
          id,
          title: unquoteFlowchartLabel(inner),
          titleRange: range(open + 1, closeIdx),
          quoteTitle: true,
        };
      }
    }
    // `X` のみ (単一識別子) → ID = タイトル = X。タイトル編集は語を置換する
    if (after === "") {
      return { index, id, title: id, titleRange: range(0, id.length), quoteTitle: false };
    }
  }

  // 識別子にならない複数語タイトル → 自動 ID、タイトルは rest 全体
  return { index, id: autoId, title: rest, titleRange: range(0, rest.length), quoteTitle: false };
}

/** subgraph 群を解析する。ネスト (stack) と文書順の自動採番に対応する */
export function tokenizeSubgraphs(text: string): SubgraphToken[] {
  const lines = allLineRanges(text);
  const open: OpenSub[] = [];
  const out: SubgraphToken[] = [];
  let index = 0;

  for (const r of lines) {
    const line = text.slice(r.start, r.end);
    const kw = /^(\s*)subgraph\b/u.exec(line);
    if (kw) {
      const indent = kw[1];
      let p = kw[0].length; // "  subgraph" の直後
      while (p < line.length && (line[p] === " " || line[p] === "\t")) p++;
      const rest = line.slice(p).replace(/[ \t]+$/u, "");
      const parsed = parseHeader(rest, r.start + p, index);
      index++;
      open.push({ ...parsed, headerRange: r, indent });
      continue;
    }
    if (END_RE.test(line) && open.length > 0) {
      const top = open.pop()!;
      out.push({
        id: top.id,
        title: top.title,
        titleRange: top.titleRange,
        quoteTitle: top.quoteTitle,
        headerRange: top.headerRange,
        endRange: r,
        indent: top.indent,
      });
    }
  }
  // end 検出順 (内側が先) になるので、文書順 (ヘッダ位置) に並べ直す
  return out.sort((a, b) => a.headerRange.start - b.headerRange.start);
}

/** subgraph の本文インデント (既存本文行から検出、無ければヘッダ + INDENT) */
function bodyIndent(text: string, sg: SubgraphToken): string {
  const lines = allLineRanges(text);
  for (const r of lines) {
    if (r.start <= sg.headerRange.start || r.start >= sg.endRange.start) continue;
    const line = text.slice(r.start, r.end);
    if (line.trim() === "") continue;
    return /^[ \t]*/u.exec(line)?.[0] ?? sg.indent + INDENT;
  }
  return sg.indent + INDENT;
}

/** 既存ノード id を subgraph (subgraphId) の end 直前へ bare 参照として挿入する */
export function subgraphAddNodeEdit(text: string, subgraphId: string, nodeId: string): TextEdit | null {
  const sg = tokenizeSubgraphs(text).find((s) => s.id === subgraphId);
  if (!sg) return null;
  return insertStatement(text, sg.endRange, "before", nodeId, bodyIndent(text, sg));
}

/**
 * 新しい subgraph ブロックを文末へ生成し、ノードを 1 つ入れる TextEdit を返す。
 * 形式は `subgraph <freshId>[<title>]` (角括弧形式なのでタイトルを GUI で編集できる)。
 */
export function createSubgraphBlockEdit(text: string, nodeId: string, freshId: string, title: string): TextEdit {
  const block = `${INDENT}subgraph ${freshId}[${quoteFlowchartLabel(title)}]\n${INDENT}${INDENT}${nodeId}\n${INDENT}end`;
  const end = text.replace(/\s+$/u, "").length; // 末尾空白を除く文末の位置
  return { range: { start: end, end }, newText: `\n${block}` };
}
