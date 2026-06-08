import type {
  ActorToken,
  BlockToken,
  EdgeLabelToken,
  EdgeLabelVisual,
  EdgeToken,
  EdgeVisual,
  EditableElement,
  MessageToken,
  NodeToken,
  NodeVisual,
  NoteToken,
  TextVisual,
} from "./types";

// 統合層: 視覚モデル (SVG) とソースモデル (トークン) を突き合わせる

/**
 * SVG からノードの g 要素を抽出し、論理 ID を逆引きする。
 */
export function extractNodeVisuals(svg: SVGSVGElement): NodeVisual[] {
  const visuals: NodeVisual[] = [];
  for (const el of svg.querySelectorAll<SVGGElement>("g.node")) {
    const id = parseNodeId(el.getAttribute("id"), el.getAttribute("data-id"));
    if (id) visuals.push({ id, el });
  }
  return visuals;
}

/**
 * SVG ノードの id / data-id から論理ノード ID を復元する。
 *
 * Mermaid v11 のノード g 要素は id="<描画ID>-flowchart-<id>-<連番>" の形式
 * (描画 ID の接頭辞が付く)。data-id は存在しないバージョンがあるため、
 * 存在すればそれを優先し、無ければ id のパターンから抽出する。
 */
export function parseNodeId(domId: string | null, dataId: string | null): string | null {
  if (dataId) return dataId;
  const m = domId?.match(/flowchart-(.+)-\d+$/);
  return m ? m[1] : null;
}

/** ノードの視覚モデルとソースモデルを ID で突き合わせる */
export function correlateNodes(
  visuals: readonly NodeVisual[],
  tokens: readonly NodeToken[],
): EditableElement[] {
  const tokenById = new Map(tokens.map((t) => [t.id, t]));
  return visuals.map((v) => {
    const token = tokenById.get(v.id);
    return {
      id: v.id,
      kind: "node" as const,
      el: v.el,
      refId: v.id,
      // label は単一範囲、id は宣言 + 全参照を置換するリネーム用フィールド
      fields: token
        ? [
            { name: "label", value: token.label, ranges: [token.labelRange] },
            { name: "id", value: token.id, ranges: token.idRanges },
          ]
        : [],
      removeLines: token?.removeLines,
      shapeRanges: token ? { open: token.shapeOpen, close: token.shapeClose } : undefined,
    };
  });
}

/**
 * SVG からエッジラベルの g 要素を抽出する (非空テキストのみ、辺の順)。
 * 未ラベルの辺も空の g.edgeLabel を生む (transform NaN) ため除外する。
 */
export function extractEdgeLabelVisuals(svg: SVGSVGElement): EdgeLabelVisual[] {
  const visuals: EdgeLabelVisual[] = [];
  for (const el of svg.querySelectorAll<SVGGElement>("g.edgeLabel")) {
    const text = (el.textContent ?? "").trim();
    if (text) visuals.push({ text, el });
  }
  return visuals;
}

/**
 * エッジラベルを「表示テキスト一致 + 出現順」で突き合わせる。
 * SVG に id が無いため、トークンの label と一致する未消費の g.edgeLabel を
 * 順に割り当てる。これにより未ラベル辺や (将来の) インラインラベルが
 * 混在しても整合する。
 */
export function correlateEdgeLabels(
  visuals: readonly EdgeLabelVisual[],
  tokens: readonly EdgeLabelToken[],
): EditableElement[] {
  const remaining = [...visuals];
  const result: EditableElement[] = [];
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k];
    const idx = remaining.findIndex((v) => v.text === token.label.trim());
    if (idx === -1) continue; // 対応する SVG ラベルが見つからない
    const [v] = remaining.splice(idx, 1);
    result.push({
      id: `edgeLabel-${k}`,
      kind: "edgeLabel",
      el: v.el,
      fields: [{ name: "label", value: token.label, ranges: [token.labelRange] }],
    });
  }
  return result;
}

// ---- エッジ (パス) ----

/**
 * SVG のエッジパス (path.flowchart-link) を抽出し、id から from/to/index を復元する。
 * id は "<描画ID>-L_<from>_<to>_<index>" 形式。ID が "_" を含み得るため、
 * 既知のノード ID 集合を使って from/to の分割を曖昧性なく決める。
 */
export function extractEdgeVisuals(svg: SVGSVGElement, nodeIds: ReadonlySet<string>): EdgeVisual[] {
  const visuals: EdgeVisual[] = [];
  for (const el of svg.querySelectorAll<SVGGraphicsElement>("path.flowchart-link")) {
    const parsed = parseEdgePathId(el.getAttribute("id"), nodeIds);
    if (parsed) visuals.push({ ...parsed, el });
  }
  return visuals;
}

export function parseEdgePathId(
  domId: string | null,
  nodeIds: ReadonlySet<string>,
): { fromId: string; toId: string; index: number } | null {
  const m = domId?.match(/L_(.+)_(\d+)$/);
  if (!m) return null;
  const index = Number(m[2]);
  const pair = m[1];
  // "<from>_<to>" を既知 ID で分割する
  for (let k = 1; k < pair.length; k++) {
    if (pair[k] !== "_") continue;
    const fromId = pair.slice(0, k);
    const toId = pair.slice(k + 1);
    if (nodeIds.has(fromId) && nodeIds.has(toId)) return { fromId, toId, index };
  }
  return null;
}

/** エッジを (from, to, index) で突き合わせ、from/to (と任意の label) を編集フィールドにする */
export function correlateEdges(
  visuals: readonly EdgeVisual[],
  tokens: readonly EdgeToken[],
): EditableElement[] {
  const key = (f: string, t: string, i: number) => `${f} ${t} ${i}`;
  const tokenByKey = new Map(tokens.map((e) => [key(e.fromId, e.toId, e.index), e]));
  const result: EditableElement[] = [];
  for (const v of visuals) {
    const token = tokenByKey.get(key(v.fromId, v.toId, v.index));
    if (!token) continue;
    const fields = [
      { name: "from", value: token.fromId, ranges: [token.fromRange] },
      { name: "to", value: token.toId, ranges: [token.toRange] },
    ];
    if (token.label) {
      fields.unshift({ name: "label", value: token.label.value, ranges: [token.label.range] });
    }
    result.push({
      id: `edge-${v.fromId}-${v.toId}-${v.index}`,
      kind: "edge",
      el: v.el,
      fields,
      removeLines: [token.statementRange],
      operatorRange: token.linkRange,
      endpoints: { from: token.fromRefRange, to: token.toRefRange },
    });
  }
  return result;
}

// ---- シーケンス図 ----

/**
 * ライフライン (縦線 line.actor-line) を編集要素にする。
 * mermaid は name 属性にアクター ID を持たせるため、それを refId にする。
 * fields は空 (ラベル編集不可)。任意タイミングからのメッセージ挿入の起点に使う。
 */
export function extractLifelines(svg: SVGSVGElement): EditableElement[] {
  const result: EditableElement[] = [];
  for (const el of svg.querySelectorAll<SVGGraphicsElement>("line.actor-line")) {
    const id = el.getAttribute("name");
    if (id) result.push({ id: `lifeline-${id}`, kind: "lifeline", el, refId: id, fields: [] });
  }
  return result;
}

/**
 * text 要素を内包する箱 (親 g) を返す。クリック領域を文字ではなく図形全体に
 * 重ねるため、幾何は箱を用いる。mermaid はアクター/ノートの rect と text を
 * 共通の g にまとめるので、その g の外接矩形が図形の枠になる。
 */
function boxOf(textEl: SVGGraphicsElement): SVGGraphicsElement {
  const parent = textEl.parentElement;
  return parent && parent.tagName.toLowerCase() === "g"
    ? (parent as unknown as SVGGraphicsElement)
    : textEl;
}

/** SVG のアクター表示テキストを抽出する (上下 2 箇所をすべて返す。幾何は箱) */
export function extractActorVisuals(svg: SVGSVGElement): TextVisual[] {
  const visuals: TextVisual[] = [];
  for (const textEl of svg.querySelectorAll<SVGGraphicsElement>("text.actor")) {
    const text = (textEl.textContent ?? "").trim();
    if (text) visuals.push({ text, el: boxOf(textEl) });
  }
  return visuals;
}

/**
 * SVG のメッセージ本文テキストを文書順で抽出し、同順の矢印線 (line.messageLine*) を
 * 添える。メッセージ・本文・線はいずれも文書順で 1:1 対応するため添字で対応付ける。
 */
export function extractMessageVisuals(svg: SVGSVGElement): TextVisual[] {
  const lines = svg.querySelectorAll<SVGGraphicsElement>("line.messageLine0, line.messageLine1");
  const visuals: TextVisual[] = [];
  const texts = svg.querySelectorAll<SVGGraphicsElement>("text.messageText");
  texts.forEach((el, k) => {
    const text = (el.textContent ?? "").trim();
    if (text) visuals.push({ text, el, lineEl: lines[k] });
  });
  return visuals;
}

/**
 * アクター表示名 (as の値) を表示テキスト一致で対応付ける。
 * mermaid はアクターを上下 2 箇所に描画するため、出現ごとに編集要素を生成する
 * (いずれも同じソース範囲を指すので、上下どちらをクリックしても編集・削除できる)。
 */
export function correlateActors(
  visuals: readonly TextVisual[],
  tokens: readonly ActorToken[],
): EditableElement[] {
  const byText = new Map(tokens.map((t) => [t.display.trim(), t]));
  const counts = new Map<string, number>();
  const result: EditableElement[] = [];
  for (const v of visuals) {
    const token = byText.get(v.text);
    if (!token) continue;
    const n = counts.get(token.id) ?? 0;
    counts.set(token.id, n + 1);
    result.push({
      id: n === 0 ? `actor-${token.id}` : `actor-${token.id}-${n}`,
      kind: "actor",
      el: v.el,
      refId: token.id,
      fields: [
        { name: "label", value: token.display, ranges: [token.displayRange] },
        { name: "id", value: token.id, ranges: token.idRanges },
      ],
      removeLines: token.removeLines,
    });
  }
  return result;
}

/** メッセージ本文を表示テキスト一致 + 出現順で対応付ける */
export function correlateMessages(
  visuals: readonly TextVisual[],
  tokens: readonly MessageToken[],
): EditableElement[] {
  const remaining = [...visuals];
  const result: EditableElement[] = [];
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k];
    const idx = remaining.findIndex((v) => v.text === token.text.trim());
    if (idx === -1) continue;
    const [v] = remaining.splice(idx, 1);
    result.push({
      id: `message-${k}`,
      kind: "message",
      el: v.el,
      fields: [{ name: "label", value: token.text, ranges: [token.textRange] }],
      removeLines: token.removeLines,
      operatorRange: token.arrowRange,
      activationRange: token.activationRange,
      endpoints: { from: token.fromRange, to: token.toRange },
      lineEl: v.lineEl,
    });
  }
  return result;
}

// ---- ノート ----

/** SVG のノート本文テキストを文書順で抽出する (幾何は箱) */
export function extractNoteVisuals(svg: SVGSVGElement): TextVisual[] {
  const visuals: TextVisual[] = [];
  for (const textEl of svg.querySelectorAll<SVGGraphicsElement>("text.noteText")) {
    const text = (textEl.textContent ?? "").trim();
    if (text) visuals.push({ text, el: boxOf(textEl) });
  }
  return visuals;
}

/** ノート本文を表示テキスト一致 + 出現順で対応付ける */
export function correlateNotes(
  visuals: readonly TextVisual[],
  tokens: readonly NoteToken[],
): EditableElement[] {
  const remaining = [...visuals];
  const result: EditableElement[] = [];
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k];
    const idx = remaining.findIndex((v) => v.text === token.text.trim());
    if (idx === -1) continue;
    const [v] = remaining.splice(idx, 1);
    result.push({
      id: `note-${k}`,
      kind: "note",
      el: v.el,
      fields: [{ name: "label", value: token.text, ranges: [token.textRange] }],
      removeLines: token.removeLines,
      placementRange: token.placementRange,
    });
  }
  return result;
}

// ---- 制御ブロック (loop/alt/opt) ----

/**
 * SVG の制御ブロックラベルを抽出する。
 * mermaid はラベルを角括弧で囲む (text.loopText = "[label]") ため、外側の [ ] を剥がす。
 */
export function extractBlockVisuals(svg: SVGSVGElement): TextVisual[] {
  const visuals: TextVisual[] = [];
  for (const el of svg.querySelectorAll<SVGGraphicsElement>("text.loopText")) {
    const raw = (el.textContent ?? "").trim();
    const text = raw.replace(/^\[(.*)\]$/, "$1");
    if (text) visuals.push({ text, el });
  }
  return visuals;
}

/** ブロックラベルを表示テキスト一致 + 出現順で対応付ける */
export function correlateBlocks(
  visuals: readonly TextVisual[],
  tokens: readonly BlockToken[],
): EditableElement[] {
  const remaining = [...visuals];
  const result: EditableElement[] = [];
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k];
    const idx = remaining.findIndex((v) => v.text === token.label.trim());
    if (idx === -1) continue;
    const [v] = remaining.splice(idx, 1);
    // 分岐ラベル (else/and) は SVG に描画されないため、ソース範囲を branchN フィールドとして
    // 持たせる。既存のインライン編集機構 (onApply → buildFieldEdits) でそのまま編集できる
    const branchFields = token.branches.map((b, i) => ({
      name: `branch${i}`,
      value: b.label,
      ranges: [b.labelRange],
    }));
    result.push({
      id: `block-${k}`,
      kind: "block",
      el: v.el,
      fields: [{ name: "label", value: token.label, ranges: [token.labelRange] }, ...branchFields],
      block: {
        type: token.type,
        headerStart: token.headerLineRange.start,
        branches: token.branches.map((b) => ({ keyword: b.keyword, label: b.label })),
      },
    });
  }
  return result;
}
