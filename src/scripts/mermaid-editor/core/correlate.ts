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
    // `<br>`・折り返しで描画テキストとソースがずれるため、normLabel で正規化して一致させる
    // (g.edgeLabel は 1 つの箱なのでグルーピングは不要。シーケンスのラベルと同じ扱い)
    const idx = remaining.findIndex((v) => normLabel(v.text) === normLabel(token.label));
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

/**
 * text 要素群を所属する箱 (boxOf) ごとにまとめ、各箱の全行を結合した 1 visual にする。
 * `<br/>` や折り返しで表示が複数 text に分割されても、箱単位で 1 要素として扱える
 * (箱が全行を覆うのでどの行をクリックしても当たる)。文書順を保つ。
 */
function groupByBox(textEls: Iterable<SVGGraphicsElement>): TextVisual[] {
  const byBox = new Map<SVGGraphicsElement, SVGGraphicsElement[]>();
  const order: SVGGraphicsElement[] = [];
  for (const t of textEls) {
    const box = boxOf(t);
    let arr = byBox.get(box);
    if (!arr) {
      arr = [];
      byBox.set(box, arr);
      order.push(box);
    }
    arr.push(t);
  }
  const visuals: TextVisual[] = [];
  for (const box of order) {
    const text = byBox.get(box)!.map((e) => (e.textContent ?? "").trim()).join("");
    if (text) visuals.push({ text, el: box });
  }
  return visuals;
}

/** SVG 要素の上端 y。line は y1 属性、path (自己メッセージのループ) は d の最初の座標 */
export function svgTopY(el: Element): number {
  const y1 = el.getAttribute("y1");
  if (y1 != null) return parseFloat(y1);
  const m = /[ML]\s*[-\d.]+[ ,]+([-\d.]+)/u.exec(el.getAttribute("d") ?? "");
  return m ? parseFloat(m[1]) : NaN;
}

/**
 * SVG のアクター表示テキストを抽出する (上下 2 箇所をすべて返す。幾何は箱)。
 * `<br/>` 入り表示名は行ごとに別々の text.actor になるが、同じ箱にまとまるので結合する。
 */
export function extractActorVisuals(svg: SVGSVGElement): TextVisual[] {
  return groupByBox(svg.querySelectorAll<SVGGraphicsElement>("text.actor"));
}

/**
 * SVG のメッセージを文書順で抽出し、矢印線 (.messageLine*) を主として 1 メッセージ = 1 visual にする。
 *
 * 本文 (text.messageText) は `<br/>`・折り返しで複数 text に分割され、矢印線とは個数が
 * 合わなくなる。そこで矢印線 1 本を 1 メッセージとし、本文断片は y 座標 (直下の矢印) で
 * 各メッセージへ割り当てる。これにより本文行数に依らず矢印線と添字がずれない
 * (自己メッセージのループは `<path class="messageLine0">` なのでタグを問わず拾う)。
 * 先頭行を el、残りを extraEls (クリック領域用) とする。
 */
export function extractMessageVisuals(svg: SVGSVGElement): TextVisual[] {
  const lines = [...svg.querySelectorAll<SVGGraphicsElement>(".messageLine0, .messageLine1")];
  const texts = [...svg.querySelectorAll<SVGGraphicsElement>("text.messageText")].filter(
    (e) => (e.textContent ?? "").trim() !== "",
  );
  const lineYs = lines.map(svgTopY);
  const groups: SVGGraphicsElement[][] = lines.map(() => []);
  for (const t of texts) {
    const ty = parseFloat(t.getAttribute("y") ?? "NaN");
    // 本文は矢印のすぐ上に描かれるので、その y 以下にある最初の矢印 = そのメッセージ
    let k = lineYs.findIndex((ly) => ty <= ly);
    if (k === -1) k = lines.length - 1; // どの矢印より下なら最後のメッセージ
    if (k >= 0) groups[k].push(t);
  }
  return lines.map((lineEl, k) => {
    const g = groups[k];
    return {
      text: g.map((e) => (e.textContent ?? "").trim()).join(""),
      el: g[0] ?? lineEl,
      lineEl,
      extraEls: g.slice(1),
    };
  });
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
  // `<br/>`・折り返しで結合した表示名と一致させるため、空白・ハイフン・<br> を無視して比較する
  const byNorm = new Map(tokens.map((t) => [normLabel(t.display), t]));
  const counts = new Map<string, number>();
  const result: EditableElement[] = [];
  for (const v of visuals) {
    const token = byNorm.get(normLabel(v.text));
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

/**
 * メッセージを矢印線と文書順で対応付ける (visual も token も 1 メッセージ = 1 件・同順)。
 * 本文は `<br/>`・折り返しで複数 text に割れるため、テキスト一致でなく文書順の添字で
 * 突き合わせる (extractMessageVisuals が矢印線 1 本ごとに本文断片をまとめている)。
 */
export function correlateMessages(
  visuals: readonly TextVisual[],
  tokens: readonly MessageToken[],
): EditableElement[] {
  const result: EditableElement[] = [];
  const n = Math.min(visuals.length, tokens.length);
  for (let k = 0; k < n; k++) {
    const token = tokens[k];
    const v = visuals[k];
    result.push({
      id: `message-${k}`,
      kind: "message",
      el: v.el,
      extraHits: v.extraEls && v.extraEls.length > 0 ? v.extraEls : undefined, // 2 行目以降のラベル
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

/** SVG のノート本文テキストを文書順で抽出する (幾何は箱。`<br/>` 分割は箱単位で結合) */
export function extractNoteVisuals(svg: SVGSVGElement): TextVisual[] {
  return groupByBox(svg.querySelectorAll<SVGGraphicsElement>("text.noteText"));
}

/**
 * ノート本文を文書順で対応付ける (1 ノート = 1 箱・同順)。
 * 本文は `<br/>` で複数 text に割れるため、テキスト一致でなく文書順の添字で突き合わせる。
 */
export function correlateNotes(
  visuals: readonly TextVisual[],
  tokens: readonly NoteToken[],
): EditableElement[] {
  const result: EditableElement[] = [];
  const n = Math.min(visuals.length, tokens.length);
  for (let k = 0; k < n; k++) {
    const token = tokens[k];
    result.push({
      id: `note-${k}`,
      kind: "note",
      el: visuals[k].el,
      fields: [{ name: "label", value: token.text, ranges: [token.textRange] }],
      removeLines: token.removeLines,
      placementRange: token.placementRange,
    });
  }
  return result;
}

// ---- 制御ブロック (loop/alt/opt) ----

/**
 * 制御ブロックのラベル一致用の正規化。描画時の折り返しで生じる差分を吸収する:
 * - 手動改行 `<br>` は描画時に行分割されて消える (ソースには残る) ため除去する
 * - mermaid は折り返しで空白を落とし、CJK の語中改行にはハイフン (breakString の
 *   ハイフネーション文字) を挿入するため、空白とハイフンも除いて比較する
 */
const normLabel = (s: string): string => s.replace(/<br\s*\/?>/giu, "").replace(/[\s-]+/gu, "");

/**
 * 角括弧ラベル ("[label]") の text 要素群を 1 ラベルごとにまとめる。
 * mermaid は長いラベルを折り返すと行ごとに別々の <text> 要素へ分割するため
 * ("[とても長い" / "ラベル]" のように)、`[` で始まる断片を起点に `]` で終わるまで
 * 連結して全文を復元する。先頭行を el、2 行目以降を extra (クリック領域用) とする。
 */
function groupBracketLabels(
  els: SVGGraphicsElement[],
): { text: string; el: SVGGraphicsElement; extra: SVGGraphicsElement[] }[] {
  const out: { text: string; el: SVGGraphicsElement; extra: SVGGraphicsElement[] }[] = [];
  let cur: { raw: string; el: SVGGraphicsElement; extra: SVGGraphicsElement[] } | null = null;
  const flush = () => {
    if (cur) out.push({ text: cur.raw.replace(/^\[(.*)\]$/u, "$1"), el: cur.el, extra: cur.extra });
    cur = null;
  };
  for (const el of els) {
    const t = (el.textContent ?? "").trim();
    if (!t) continue;
    if (cur && !t.startsWith("[")) {
      cur.raw += t; // 折り返しの続き
      cur.extra.push(el);
    } else {
      flush(); // 新しいラベルの開始
      cur = { raw: t, el, extra: [] };
    }
    if (cur.raw.endsWith("]")) flush();
  }
  flush();
  return out;
}

/**
 * SVG の制御ブロックヘッダラベルを抽出する。
 * mermaid はラベルを角括弧で囲む (text.loopText = "[label]") ため、外側の [ ] を剥がす。
 * 長いラベルは複数 text に折り返されるので groupBracketLabels で 1 ラベルへ結合する。
 * キーワードタブ (text.labelText = "alt"/"loop" 等) は同じ行 (近い y) に描かれるため、
 * クリック領域を広げる用途で各ヘッダ先頭行に最も近い y のタブを添える。
 */
export function extractBlockVisuals(svg: SVGSVGElement): TextVisual[] {
  const tabs = [...svg.querySelectorAll<SVGGraphicsElement>("text.labelText")];
  const yOf = (el: Element): number => parseFloat(el.getAttribute("y") ?? "NaN");
  return groupBracketLabels([...svg.querySelectorAll<SVGGraphicsElement>("text.loopText")])
    .filter((g) => g.text !== "")
    .map((g) => {
      const y = yOf(g.el);
      let tabEl: SVGGraphicsElement | undefined;
      let best = Infinity;
      for (const t of tabs) {
        const d = Math.abs(yOf(t) - y);
        if (d < best) {
          best = d;
          tabEl = t;
        }
      }
      return { text: g.text, el: g.el, tabEl, extraEls: g.extra };
    });
}

/**
 * SVG の制御ブロック分岐ラベル (else/and) を抽出する。
 * mermaid は分岐ラベルを text.sectionTitle = "[label]" として描画する (ヘッダの loopText とは別)。
 * 長いラベルは複数 text に折り返されるので groupBracketLabels で 1 ラベルへ結合する。
 */
export function extractBranchVisuals(svg: SVGSVGElement): TextVisual[] {
  return groupBracketLabels([...svg.querySelectorAll<SVGGraphicsElement>("text.sectionTitle")])
    .filter((g) => g.text !== "")
    .map((g) => ({ text: g.text, el: g.el, extraEls: g.extra }));
}

/** ブロックヘッダラベルを表示テキスト一致 + 出現順で対応付ける */
export function correlateBlocks(
  visuals: readonly TextVisual[],
  tokens: readonly BlockToken[],
): EditableElement[] {
  const remaining = [...visuals];
  const result: EditableElement[] = [];
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k];
    const idx = remaining.findIndex((v) => normLabel(v.text) === normLabel(token.label));
    if (idx === -1) continue;
    const [v] = remaining.splice(idx, 1);
    // alt タブ (キーワード) と折り返し 2 行目以降もクリック領域に含める
    const extraHits = [...(v.tabEl ? [v.tabEl] : []), ...(v.extraEls ?? [])];
    result.push({
      id: `block-${k}`,
      kind: "block",
      el: v.el,
      extraHits: extraHits.length > 0 ? extraHits : undefined,
      fields: [{ name: "label", value: token.label, ranges: [token.labelRange] }],
      block: {
        type: token.type,
        headerStart: token.headerLineRange.start,
        branches: token.branches.map((b) => ({ keyword: b.keyword, label: b.label })),
      },
    });
  }
  return result;
}

/**
 * 分岐ラベル (else/and) を独立した編集可能要素として対応付ける。
 * sectionTitle に直接アンカーするため、入力欄が分岐ラベルの位置に正しく出る。
 * 全ブロックの分岐を文書順で走査し、表示テキスト一致でラベルへ突き合わせる。
 */
export function correlateBranches(
  visuals: readonly TextVisual[],
  tokens: readonly BlockToken[],
): EditableElement[] {
  const remaining = [...visuals];
  const result: EditableElement[] = [];
  for (let k = 0; k < tokens.length; k++) {
    tokens[k].branches.forEach((b, i) => {
      if (!b.label.trim()) return; // 空ラベルは描画されないので対象外
      const idx = remaining.findIndex((v) => normLabel(v.text) === normLabel(b.label));
      if (idx === -1) return;
      const [v] = remaining.splice(idx, 1);
      result.push({
        id: `block-${k}-branch-${i}`,
        kind: "branch",
        el: v.el,
        extraHits: v.extraEls && v.extraEls.length > 0 ? v.extraEls : undefined, // 折り返し 2 行目以降
        fields: [{ name: "label", value: b.label, ranges: [b.labelRange] }],
      });
    });
  }
  return result;
}
