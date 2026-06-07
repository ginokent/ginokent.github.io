import {
  correlateActors,
  correlateBlocks,
  correlateEdgeLabels,
  correlateEdges,
  correlateMessages,
  correlateNodes,
  correlateNotes,
  extractActorVisuals,
  extractBlockVisuals,
  extractEdgeLabelVisuals,
  extractEdgeVisuals,
  extractMessageVisuals,
  extractNodeVisuals,
  extractNoteVisuals,
} from "./correlate";
import { tokenizeFlowchart } from "./source/flowchart";
import { tokenizeSequence } from "./source/sequence";
import type { EditableElement } from "./types";

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
      ...correlateNodes(nodeVisuals, t.nodes),
      ...correlateEdges(extractEdgeVisuals(svg, nodeIds), t.edges),
      ...correlateEdgeLabels(extractEdgeLabelVisuals(svg), t.edgeLabels),
    ];
  },
};

const sequenceAdapter: DiagramAdapter = {
  build(text, svg) {
    const t = tokenizeSequence(text);
    return [
      ...correlateActors(extractActorVisuals(svg), t.actors),
      ...correlateMessages(extractMessageVisuals(svg), t.messages),
      ...correlateNotes(extractNoteVisuals(svg), t.notes),
      ...correlateBlocks(extractBlockVisuals(svg), t.blocks),
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
    default:
      return null;
  }
}

/** コメント・空行を除く最初の行の先頭キーワードを返す */
export function firstKeyword(text: string): string | null {
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("%%")) continue;
    return line.match(/^[A-Za-z]+/)?.[0] ?? null;
  }
  return null;
}
