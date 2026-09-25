import {
  correlateActors,
  correlateArchEdges,
  correlateArchNodes,
  correlateBlocks,
  correlateBranches,
  correlateEdges,
  correlateMessages,
  correlateNodes,
  correlateNotes,
  correlateSubgraphs,
  correlateTitle,
  extractActorVisuals,
  extractArchEdgeVisuals,
  extractArchGroupVisuals,
  extractArchJunctionVisuals,
  extractArchServiceVisuals,
  extractBlockVisuals,
  extractBranchVisuals,
  extractClusterVisuals,
  extractLifelines,
  extractEdgeLabelVisuals,
  extractEdgeVisuals,
  extractMessageVisuals,
  extractNodeVisuals,
  extractNoteVisuals,
} from "./correlate";
import { tokenizeArchitecture } from "./source/architecture";
import { tokenizeFlowchart } from "./source/flowchart";
import { tokenizeSubgraphs } from "./source/subgraph";
import { tokenizeSequence } from "./source/sequence";
import { parseTitle } from "./structure";
import type { EditableElement } from "./types";

// frontmatter のタイトルは図種非依存。両アダプタ共通で編集要素にする
const titleElements = (text: string, svg: SVGSVGElement): EditableElement[] =>
  correlateTitle(svg, parseTitle(text));

// 図種アダプタ: テキスト + 描画済み SVG から編集可能要素を構築する。
// 図種固有の知識をここに閉じ込め、Editor は図種を意識しない。

export interface DiagramAdapter {
  build(text: string, svg: SVGSVGElement): EditableElement[];
}

const flowchartAdapter: DiagramAdapter = {
  build(text, svg) {
    const t = tokenizeFlowchart(text);
    const nodeVisuals = extractNodeVisuals(svg);
    const nodeIds = new Set(nodeVisuals.map((v) => v.id));
    return [
      ...titleElements(text, svg),
      ...correlateSubgraphs(extractClusterVisuals(svg), tokenizeSubgraphs(text)),
      ...correlateNodes(nodeVisuals, t.nodes),
      ...correlateEdges(extractEdgeVisuals(svg, nodeIds), t.edges, extractEdgeLabelVisuals(svg)),
    ];
  },
};

const sequenceAdapter: DiagramAdapter = {
  build(text, svg) {
    const t = tokenizeSequence(text);
    return [
      ...titleElements(text, svg),
      // ライフラインを先頭に置き、当たり判定でアクター/メッセージの下に敷く
      ...extractLifelines(svg),
      ...correlateActors(extractActorVisuals(svg), t.actors),
      ...correlateMessages(extractMessageVisuals(svg), t.messages),
      ...correlateNotes(extractNoteVisuals(svg), t.notes),
      ...correlateBlocks(extractBlockVisuals(svg), t.blocks),
      ...correlateBranches(extractBranchVisuals(svg), t.blocks),
    ];
  },
};

const architectureAdapter: DiagramAdapter = {
  build(text, svg) {
    const t = tokenizeArchitecture(text);
    const services = extractArchServiceVisuals(svg);
    const groups = extractArchGroupVisuals(svg);
    const junctions = extractArchJunctionVisuals(svg);
    const nodeIds = new Set([...services, ...junctions].map((v) => v.id));
    return [
      ...titleElements(text, svg),
      // group を先に置き、当たり判定を service / junction / edge の下に敷く。
      // group のヒットはラベル箱に絞ってあるため、中の要素と重ならない
      ...correlateArchNodes(groups, t.nodes),
      ...correlateArchNodes(services, t.nodes),
      ...correlateArchNodes(junctions, t.nodes),
      ...correlateArchEdges(extractArchEdgeVisuals(svg, nodeIds), t.edges),
    ];
  },
};

/** 先頭の図種キーワードからアダプタを選ぶ。未対応図種は null */
export function pickAdapter(text: string): DiagramAdapter | null {
  switch (firstKeyword(text)) {
    case "sequenceDiagram":
      return sequenceAdapter;
    case "flowchart":
    case "graph":
      return flowchartAdapter;
    case "architecture-beta":
      return architectureAdapter;
    default:
      return null;
  }
}

/** コメント・空行を除く最初の行の先頭キーワードを返す */
export function firstKeyword(text: string): string | null {
  const lines = text.split("\n");
  // 先頭の YAML フロントマター (--- ... ---) を飛ばしてから図種キーワードを探す
  let i = 0;
  const first = lines.findIndex((l) => l.trim() !== "");
  if (first !== -1 && lines[first].trim() === "---") {
    i = first + 1;
    while (i < lines.length && lines[i].trim() !== "---") i++;
    i++; // 閉じ --- の次へ
  }
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("%%")) continue;
    // ハイフンも含めて図種キーワードとして扱う (例: architecture-beta)
    return line.match(/^[A-Za-z][A-Za-z-]*/)?.[0] ?? null;
  }
  return null;
}
