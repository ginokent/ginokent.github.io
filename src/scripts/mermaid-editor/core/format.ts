import { firstKeyword } from "./adapter";
import { tokenizeFlowchart } from "./source/flowchart";
import { tokenizeSubgraphs } from "./source/subgraph";
import { tokenizeSequence } from "./source/sequence";
import { allLineRanges, headerLineIndex, INDENT } from "./structure";
import type { SourceRange } from "./types";

// 整形 (fmt): コピペした任意の mermaid を「宣言を上にまとめる」正準レイアウトへ書き換える。
// surgical edit ではなく図全体の再構築 (明示操作)。対応図種のみ。非対応は null を返す。
//
// 方針 (ユーザー確認: 集約 + 暗黙を明示化):
//   - flowchart: 全ノード宣言を先頭へ集約 (インライン宣言を展開し、未宣言ノードにも宣言行を作る)、
//     エッジは下。subgraph ブロック・コメント・スタイル定義等は可能な限り保持する
//   - sequence: 全 participant を先頭へ集約 (暗黙アクターにも participant を補う)、以降は元の順

/** 対応図種なら整形後テキストを、非対応 (図種不明等) なら null を返す */
export function formatSource(text: string): string | null {
  switch (firstKeyword(text)) {
    case "flowchart":
    case "graph":
      return formatFlowchart(text);
    case "sequenceDiagram":
      return formatSequence(text);
    default:
      return null;
  }
}

/** 先頭の YAML フロントマター (--- … ---) を取り出す。無ければ null と本体開始 index 0 */
function splitFrontmatter(text: string, lines: readonly SourceRange[]): { front: string | null; bodyStart: number } {
  const first = lines.findIndex((r) => text.slice(r.start, r.end).trim() !== "");
  if (first === -1 || text.slice(lines[first].start, lines[first].end).trim() !== "---") {
    return { front: null, bodyStart: 0 };
  }
  for (let k = first + 1; k < lines.length; k++) {
    if (text.slice(lines[k].start, lines[k].end).trim() === "---") {
      const front = lines.slice(first, k + 1).map((r) => text.slice(r.start, r.end)).join("\n");
      return { front, bodyStart: k + 1 };
    }
  }
  return { front: null, bodyStart: 0 };
}

/** 非空ブロックを空行 (1 行) で区切って連結する。各ブロック内の行は改行で繋ぐ */
function joinBlocks(...blocks: string[][]): string {
  return blocks
    .filter((b) => b.length > 0)
    .map((b) => b.join("\n"))
    .join("\n\n");
}

function formatFlowchart(text: string): string {
  const lines = allLineRanges(text);
  const slice = (r: SourceRange) => text.slice(r.start, r.end);
  const { front, bodyStart } = splitFrontmatter(text, lines);
  const headerIdx = headerLineIndex(text);
  if (headerIdx === -1) return text;
  const headerLine = slice(lines[headerIdx]).trim();

  const { nodes, edges } = tokenizeFlowchart(text);
  const subs = tokenizeSubgraphs(text);

  // subgraph が占めるテキスト範囲 (ヘッダ先頭〜end 末尾) と、トップレベル判定
  const subRanges = subs.map((s) => ({ start: s.headerRange.start, end: s.endRange.end }));
  const inSub = (offset: number) => subRanges.some((r) => offset >= r.start && offset < r.end);
  const topLevelSubs = subs.filter((s) => !subRanges.some((r) => s.headerRange.start > r.start && s.headerRange.start < r.end));

  // ノード宣言テキスト (形状付き)。subgraph 内で宣言されたノードはブロックに残すため別管理にする
  const topDecl = new Map<string, string>(); // トップレベルで形状宣言されたノード id → 宣言テキスト
  const declaredInSub = new Set<string>(); // subgraph ブロック内で形状宣言されたノード id
  for (const n of nodes) {
    if (inSub(n.shapeOpen.start)) declaredInSub.add(n.id);
    else topDecl.set(n.id, `${n.id}${slice(n.shapeOpen)}${slice(n.labelRange)}${slice(n.shapeClose)}`);
  }

  // トップレベルに現れるノード id を初出順に集める。subgraph のメンバー (ブロック内で bare 参照)
  // でも、宣言 (ラベル) がトップレベルにあるノードは先頭へ集約する — ブロックには bare 参照が
  // 残るためメンバーシップは保たれ、ラベルも失われない。subgraph 内だけで宣言されたノードは
  // 重複を避けてブロックに残す (集約しない)。
  const firstSeen = new Map<string, number>();
  const see = (id: string, offset: number) => {
    if (!firstSeen.has(id) || offset < firstSeen.get(id)!) firstSeen.set(id, offset);
  };
  for (const n of nodes) if (!inSub(n.shapeOpen.start)) see(n.id, n.shapeOpen.start);
  for (const e of edges) {
    if (inSub(e.statementRange.start)) continue;
    see(e.fromId, e.fromRange.start);
    see(e.toId, e.toRange.start);
  }
  const declLines = [...firstSeen.entries()]
    .sort((a, b) => a[1] - b[1])
    .filter(([id]) => topDecl.has(id) || !declaredInSub.has(id))
    .map(([id]) => `${INDENT}${topDecl.get(id) ?? id}`);

  // エッジ (トップレベル) を bare な id で再構築する
  const edgeLines = edges
    .filter((e) => !inSub(e.statementRange.start))
    .map((e) => {
      const label = e.label ? `|${slice(e.label.range)}|` : "";
      return `${INDENT}${e.fromId} ${slice(e.linkRange)}${label} ${e.toId}`;
    });

  // subgraph ブロックはそのまま保持する (内部の宣言・割り当てを壊さない)
  const subBlocks = topLevelSubs.map((s) => text.slice(s.headerRange.start, s.endRange.end));

  // 消費済み行 (ヘッダ / subgraph 内 / 純粋なノード宣言行 / エッジ行) を除いた残り (コメント・スタイル等) を保持
  const consumed = new Set<number>();
  consumed.add(lines[headerIdx].start);
  const lineStartAt = (offset: number) => lines.find((r) => offset >= r.start && offset <= r.end)?.start;
  for (const n of nodes) if (!inSub(n.shapeOpen.start)) { const s = lineStartAt(n.shapeOpen.start); if (s !== undefined) consumed.add(s); }
  for (const e of edges) if (!inSub(e.statementRange.start)) for (const r of lines) if (r.start >= e.statementRange.start && r.end <= e.statementRange.end) consumed.add(r.start);
  const otherLines: string[] = [];
  for (let i = bodyStart; i < lines.length; i++) {
    const r = lines[i];
    if (inSub(r.start) || consumed.has(r.start)) continue;
    const line = slice(r);
    if (line.trim() === "") continue;
    otherLines.push(line);
  }

  // 順序: ノード宣言 → subgraph (グルーピング) → エッジ (矢印) → その他 (コメント/スタイル)。
  // 宣言してから束ね、最後に関係を引く読み手の理解順に沿う (mermaid は順序非依存)。
  // ヘッダ + 宣言を 1 ブロックとし、subgraph / エッジ / その他は空行で区切って見やすくする
  const body = joinBlocks([headerLine, ...declLines], subBlocks, edgeLines, otherLines);
  return front ? `${front}\n${body}` : body;
}

function formatSequence(text: string): string {
  const lines = allLineRanges(text);
  const slice = (r: SourceRange) => text.slice(r.start, r.end);
  const { front, bodyStart } = splitFrontmatter(text, lines);
  const headerIdx = headerLineIndex(text);
  if (headerIdx === -1) return text;
  const headerLine = slice(lines[headerIdx]).trim();

  const { actors, messages } = tokenizeSequence(text);

  // 宣言済みアクターの表示名 (集約時に participant 行を再構築するのに使う)
  const declActor = new Map(actors.map((a) => [a.id, a.display]));

  // 全アクター id を初出順に集める (宣言 + メッセージの from/to。暗黙アクターも含む)
  const firstSeen = new Map<string, number>();
  const see = (id: string, offset: number) => {
    if (!firstSeen.has(id) || offset < firstSeen.get(id)!) firstSeen.set(id, offset);
  };
  for (const a of actors) see(a.id, a.idRanges[0]?.start ?? 0);
  for (const m of messages) {
    see(text.slice(m.fromRange.start, m.fromRange.end), m.fromRange.start);
    see(text.slice(m.toRange.start, m.toRange.end), m.toRange.start);
  }
  const participantLines = [...firstSeen.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([id]) => {
      const disp = declActor.get(id);
      return disp !== undefined && disp !== id ? `${INDENT}participant ${id} as ${disp}` : `${INDENT}participant ${id}`;
    });

  // autonumber は (あれば) ヘッダ直後へ寄せる。participant/actor の宣言行は集約済みなので除く
  const autonumberLines: string[] = [];
  const restLines: string[] = [];
  for (let i = bodyStart; i < lines.length; i++) {
    if (i === headerIdx) continue;
    const line = slice(lines[i]);
    if (line.trim() === "") continue;
    if (/^\s*(participant|actor)\b/u.test(line)) continue; // 宣言は participantLines へ集約済み
    if (/^\s*autonumber\b/u.test(line)) {
      autonumberLines.push(`${INDENT}autonumber`);
      continue;
    }
    restLines.push(line);
  }

  // ヘッダ + autonumber + participant 群を 1 ブロックとし、本体 (メッセージ/ノート等) を
  // 空行で区切る (flowchart と同じく宣言と関係を視覚的に分ける)
  const body = joinBlocks([headerLine, ...autonumberLines, ...participantLines], restLines);
  return front ? `${front}\n${body}` : body;
}
