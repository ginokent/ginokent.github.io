import type { EditableElement, NotePlacement } from "../core/types";
import { openInlineEditor } from "./inline";
import { openMenu, type MenuAction } from "./menu";

// オーバーレイ層: SVG の上に当たり判定を重ねる。
//   - ノード等  : HTML の透明 div ヒット
//   - エッジ    : SVG 上に重ねる透明で太いパス (線全体をクリックしやすく)
// 操作:
//   - シングルクリック → メニュー
//   - ダブルクリック   → ラベルを直接インライン編集
//   - ノード選択モード → 対象ノードのクリックで確定 (エッジ追加 / 再接続)

const SVGNS = "http://www.w3.org/2000/svg";
const DBLCLICK_DELAY = 220; // ms
const EDGE_HIT_WIDTH = 16; // エッジのクリック可能領域の太さ (SVG ユーザー単位)
const MSG_BAND_PX = 18; // メッセージ矢印のクリック帯の太さ (画面ピクセル)
const LIFELINE_BAND_PX = 14; // ライフライン (縦線) のクリック帯の太さ (画面ピクセル)

const FIELD_LABELS: Record<string, string> = {
  label: "ラベル",
  id: "ID",
};

/** ノード形状の候補 (名前 → 括弧) */
const SHAPE_CHOICES: ReadonlyArray<{ name: string; open: string; close: string }> = [
  { name: "矩形", open: "[", close: "]" },
  { name: "角丸", open: "(", close: ")" },
  { name: "スタジアム", open: "([", close: "])" },
  { name: "円", open: "((", close: "))" },
  { name: "ひし形", open: "{", close: "}" },
  { name: "六角形", open: "{{", close: "}}" },
  { name: "サブルーチン", open: "[[", close: "]]" },
  { name: "円柱", open: "[(", close: ")]" },
];

/** エッジの線種候補 (名前 → リンク演算子) */
const EDGE_TYPES: ReadonlyArray<{ name: string; op: string }> = [
  { name: "実線矢印", op: "-->" },
  { name: "点線矢印", op: "-.->" },
  { name: "太線矢印", op: "==>" },
  { name: "実線 (矢印なし)", op: "---" },
  { name: "終端 x", op: "--x" },
  { name: "終端 o", op: "--o" },
];

/** メッセージの矢印種別候補 (名前 → 矢印演算子) */
const MESSAGE_ARROWS: ReadonlyArray<{ name: string; op: string }> = [
  { name: "実線矢印", op: "->>" },
  { name: "点線矢印", op: "-->>" },
  { name: "実線 (矢印なし)", op: "->" },
  { name: "点線 (矢印なし)", op: "-->" },
  { name: "終端 x", op: "-x" },
  { name: "非同期 )", op: "-)" },
];

export interface OverlayCallbacks {
  onApply(el: EditableElement, changes: Record<string, string>): void;
  onAddEdge(fromId: string, toId: string): void;
  onAddConnectedNode(fromId: string): void;
  onAddMessage(fromId: string, toId: string): void;
  onInsertMessage(fromId: string, toId: string, anchorId: string | null): void;
  onRemove(el: EditableElement): void;
  onSetShape(el: EditableElement, open: string, close: string): void;
  onSetOperator(el: EditableElement, op: string): void;
  onReverse(el: EditableElement): void;
  onSetActivation(el: EditableElement, sign: string): void;
  onAddNote(placement: NotePlacement, actorIds: string[], anchorId: string | null): void;
  onSetNotePlacement(el: EditableElement, placement: NotePlacement, actorIds: string[]): void;
}

export function drawOverlay(
  overlayEl: HTMLElement,
  stageEl: HTMLElement,
  elements: readonly EditableElement[],
  cb: OverlayCallbacks,
): void {
  overlayEl.replaceChildren();
  const stageRect = stageEl.getBoundingClientRect();
  // ヒット div は overlay の子なので、overlay 自身の矩形を原点に配置する。
  // stage には border/padding があり、overlay は (inset:0 で) stage のパディングボックスを
  // 基準にするため、stage の矩形基準だと border 分 (1px) 右下へずれてしまう。
  const overlayRect = overlayEl.getBoundingClientRect();
  const svg = stageEl.querySelector("svg");

  // 開いているメニュー / 入力欄は 1 つに限定する
  let active: (() => void) | null = null;
  const setActive = (close: () => void) => {
    active?.();
    active = close;
  };

  // 操作モード: 要素選択 (pickActor) / ノート配置 (placeNote)。
  // Esc または枠外 (ヒット以外) のクリックで取消できる。
  type Pending =
    | { kind: "pickActor"; accept: (el: EditableElement) => boolean; onPick: (refId: string) => void }
    | { kind: "placeNote"; placement: NotePlacement; actorIds: string[] };
  let pending: Pending | null = null;
  let pickSource: Element | null = null;
  let hint: HTMLElement | null = null;
  let outsideTimer: number | undefined;
  const onPickKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") cancelPending();
  };
  // ヒット要素のハンドラが先に pending を処理して消すため、ここで残っていれば枠外クリック
  const onOutsideClick = () => {
    if (pending) cancelPending();
  };
  function cancelPending(): void {
    pending = null;
    pickSource?.classList.remove("pick-source");
    pickSource = null;
    overlayEl.classList.remove("picking");
    hint?.remove();
    hint = null;
    window.clearTimeout(outsideTimer);
    document.removeEventListener("keydown", onPickKey);
    document.removeEventListener("click", onOutsideClick);
  }
  function beginPending(p: Pending, hintText: string, source?: Element): void {
    active?.();
    active = null;
    pending = p;
    pickSource = source ?? null;
    pickSource?.classList.add("pick-source");
    overlayEl.classList.add("picking");
    hint = document.createElement("div");
    hint.className = "pick-hint";
    hint.textContent = hintText;
    overlayEl.append(hint);
    document.addEventListener("keydown", onPickKey);
    // 開始のクリック自身を拾わないよう、枠外クリック検知は次のティックで登録する
    outsideTimer = window.setTimeout(() => document.addEventListener("click", onOutsideClick), 0);
  }
  const startPickActor = (
    hintText: string,
    accept: (el: EditableElement) => boolean,
    onPick: (refId: string) => void,
    source?: Element,
  ) => beginPending({ kind: "pickActor", accept, onPick }, hintText, source);
  const startPlaceNote = (placement: NotePlacement, actorIds: string[], hintText: string, source?: Element) =>
    beginPending({ kind: "placeNote", placement, actorIds }, hintText, source);

  /** pickActor 中にクリックされた要素を送信先候補として確定/取消する */
  const resolvePick = (el: EditableElement): void => {
    if (pending?.kind !== "pickActor") return;
    const ok = pending.accept(el) && el.refId !== undefined;
    const { onPick } = pending;
    cancelPending();
    if (ok) onPick(el.refId!);
  };

  const edit = (el: EditableElement, fieldName: string, anchor: () => DOMRect) =>
    setActive(openInlineEditor(overlayEl, anchor(), stageRect, el, fieldName, cb));

  const hasLabel = (el: EditableElement) => el.fields.some((f) => f.name === "label");
  const isNode = (el: EditableElement) => el.kind === "node";
  // メッセージの送信先は、アクターの箱でも縦線 (lifeline) でも選べる
  const isActorTarget = (el: EditableElement) => el.kind === "actor" || el.kind === "lifeline";

  const actionsFor = (el: EditableElement, anchor: () => DOMRect, hitEl: Element): MenuAction[] => {
    if (el.kind === "edge") {
      const a: MenuAction[] = [];
      if (hasLabel(el)) a.push({ label: "ラベルを編集", onSelect: () => edit(el, "label", anchor) });
      a.push({
        label: "接続元を変更",
        onSelect: () =>
          startPickActor("新しい接続元のノードをクリック (Esc で取消)", isNode, (id) => cb.onApply(el, { from: id })),
      });
      a.push({
        label: "接続先を変更",
        onSelect: () =>
          startPickActor("新しい接続先のノードをクリック (Esc で取消)", isNode, (id) => cb.onApply(el, { to: id })),
      });
      if (el.operatorRange) {
        a.push({
          label: "線種を変更 ▸",
          onSelect: () =>
            setActive(
              openMenu(
                overlayEl,
                anchor(),
                stageRect,
                EDGE_TYPES.map((t) => ({ label: t.name, onSelect: () => cb.onSetOperator(el, t.op) })),
              ),
            ),
        });
      }
      if (el.endpoints) a.push({ label: "矢印の向きを入れ替える", onSelect: () => cb.onReverse(el) });
      addRemove(a, el);
      return a;
    }
    const a: MenuAction[] = el.fields.map((f) => ({
      label: `${FIELD_LABELS[f.name] ?? f.name}を編集`,
      onSelect: () => edit(el, f.name, anchor),
    }));
    if (el.kind === "node") {
      a.push({
        label: "新規ノードへ矢印",
        onSelect: () => cb.onAddConnectedNode(el.refId!),
      });
      a.push({
        label: "既存ノードへ矢印",
        onSelect: () =>
          startPickActor(`${el.refId} から接続先のノードをクリック (Esc で取消)`, isNode, (to) => cb.onAddEdge(el.refId!, to), hitEl),
      });
      if (el.shapeRanges) {
        a.push({
          label: "形状を変更 ▸",
          onSelect: () => setActive(openMenu(overlayEl, anchor(), stageRect, shapeActions(el))),
        });
      }
    }
    if (el.kind === "actor" && el.refId) {
      a.push({
        label: "メッセージを追加",
        onSelect: () =>
          startPickActor(`${el.refId} から相手のアクター (箱か縦線) をクリック (Esc で取消)`, isActorTarget, (to) => cb.onAddMessage(el.refId!, to), hitEl),
      });
      a.push({
        label: "ノートを追加 ▸",
        onSelect: () => setActive(openMenu(overlayEl, anchor(), stageRect, noteActions(el.refId!, hitEl))),
      });
    }
    if (el.kind === "message") {
      if (el.operatorRange) {
        a.push({
          label: "種別を変更 ▸",
          onSelect: () =>
            setActive(
              openMenu(
                overlayEl,
                anchor(),
                stageRect,
                MESSAGE_ARROWS.map((t) => ({ label: t.name, onSelect: () => cb.onSetOperator(el, t.op) })),
              ),
            ),
        });
      }
      if (el.activationRange) {
        a.push({
          label: "アクティベーション ▸",
          onSelect: () =>
            setActive(
              openMenu(overlayEl, anchor(), stageRect, [
                { label: "対象を起動 (+)", onSelect: () => cb.onSetActivation(el, "+") },
                { label: "対象を終了 (−)", onSelect: () => cb.onSetActivation(el, "-") },
                { label: "起動/終了を解除", onSelect: () => cb.onSetActivation(el, "") },
              ]),
            ),
        });
      }
      if (el.endpoints) a.push({ label: "矢印の向きを入れ替える", onSelect: () => cb.onReverse(el) });
    }
    if (el.kind === "note" && el.placementRange) {
      a.push({
        label: "配置を変更 ▸",
        onSelect: () => setActive(openMenu(overlayEl, anchor(), stageRect, notePlacementActions(el))),
      });
    }
    addRemove(a, el);
    return a;
  };

  // ノートの配置変更: 配置を選び、対象アクター (箱か縦線) をクリックして確定する
  const notePlacementActions = (el: EditableElement): MenuAction[] => {
    const pickOne = (placement: NotePlacement) =>
      startPickActor("ノートを置くアクター (箱か縦線) をクリック (Esc で取消)", isActorTarget, (id) =>
        cb.onSetNotePlacement(el, placement, [id]),
      );
    return [
      { label: "右側に", onSelect: () => pickOne("right") },
      { label: "左側に", onSelect: () => pickOne("left") },
      { label: "重ねる (1 つ)", onSelect: () => pickOne("over") },
      {
        label: "またぐ (2 つ) ▸",
        onSelect: () =>
          startPickActor("1 人目のアクター (箱か縦線) をクリック (Esc で取消)", isActorTarget, (first) =>
            startPickActor("2 人目のアクター (箱か縦線) をクリック (Esc で取消)", isActorTarget, (second) =>
              cb.onSetNotePlacement(el, "over", [first, second]),
            ),
          ),
      },
    ];
  };

  const shapeActions = (el: EditableElement): MenuAction[] =>
    SHAPE_CHOICES.map((s) => ({
      label: s.name,
      onSelect: () => cb.onSetShape(el, s.open, s.close),
    }));

  // ノート配置の選択。選んだ後にライフライン上の高さをクリックして位置を決める。
  // 「2 者にまたがる」は相手アクターを選んでから高さを指定する。
  const noteActions = (actorId: string, hitEl: Element): MenuAction[] => {
    const place = (placement: NotePlacement, ids: string[], where: string) =>
      startPlaceNote(placement, ids, `${where}のノートを置く高さをライフライン上でクリック (Esc で取消)`, hitEl);
    return [
      { label: "右側に", onSelect: () => place("right", [actorId], `${actorId} の右`) },
      { label: "左側に", onSelect: () => place("left", [actorId], `${actorId} の左`) },
      { label: "重ねる", onSelect: () => place("over", [actorId], `${actorId} 上`) },
      {
        label: "2 者にまたがる ▸",
        onSelect: () =>
          startPickActor(
            `${actorId} とまたぐ相手のアクター (箱か縦線) をクリック (Esc で取消)`,
            isActorTarget,
            (other) => place("over", [actorId, other], `${actorId},${other}`),
            hitEl,
          ),
      },
    ];
  };

  function addRemove(actions: MenuAction[], el: EditableElement): void {
    if (el.removeLines && el.removeLines.length > 0) {
      actions.push({ label: "削除", onSelect: () => cb.onRemove(el) });
    }
  }

  const wire = (hitEl: Element, el: EditableElement, anchor: () => DOMRect) => {
    let clickTimer: number | undefined;
    hitEl.addEventListener("click", () => {
      if (pending) {
        // pickActor 中はこの要素を送信先候補に。placeNote 中の非ライフラインは取消
        if (pending.kind === "pickActor") resolvePick(el);
        else cancelPending();
        return;
      }
      window.clearTimeout(clickTimer);
      clickTimer = window.setTimeout(() => {
        setActive(openMenu(overlayEl, anchor(), stageRect, actionsFor(el, anchor, hitEl)));
      }, DBLCLICK_DELAY);
    });
    hitEl.addEventListener("dblclick", () => {
      window.clearTimeout(clickTimer);
      if (pending) return;
      if (hasLabel(el)) edit(el, "label", anchor);
    });
  };

  for (const el of elements) {
    // ライフライン (縦線): 任意の高さをクリックして、その位置から相手アクターへ
    // メッセージを挿入する。クリックの y からどのメッセージ間に挿むかを決める。
    if (el.kind === "lifeline" && el.refId) {
      const from = el.refId;
      const r = el.el.getBoundingClientRect();
      const band = document.createElement("div");
      band.className = "hit lifeline-hit";
      band.style.left = `${r.left + r.width / 2 - LIFELINE_BAND_PX / 2 - overlayRect.left}px`;
      band.style.top = `${r.top - overlayRect.top}px`;
      band.style.width = `${LIFELINE_BAND_PX}px`;
      band.style.height = `${r.height}px`;
      band.title = `${from}: クリックでこの位置からメッセージを追加`;
      band.addEventListener("click", (e) => {
        // 送信先ピック中はこの縦線を送信先として確定する (アクターの箱と同等)
        if (pending?.kind === "pickActor") {
          resolvePick(el);
          return;
        }
        // ノート配置中はこの高さに、選んだ配置のノートを挿入する
        if (pending?.kind === "placeNote") {
          const { placement, actorIds } = pending;
          const anchorId = insertionAnchor(elements, (e as MouseEvent).clientY);
          cancelPending();
          cb.onAddNote(placement, actorIds, anchorId);
          return;
        }
        const anchorId = insertionAnchor(elements, (e as MouseEvent).clientY);
        startPickActor(`${from} からの送信先 (アクターの箱か縦線) をクリック (Esc で取消)`, isActorTarget, (to) => cb.onInsertMessage(from, to, anchorId), band);
      });
      overlayEl.append(band);
      continue;
    }

    if (el.fields.length === 0) continue; // 編集不可要素はスキップ

    if (el.kind === "edge") {
      if (!svg) continue;
      const hit = makeEdgeHit(el.el);
      svg.append(hit);
      wire(hit, el, () => midpointClientRect(el.el));
      continue;
    }

    // メッセージは矢印線にもクリック領域を張る (ラベルだけでなく線をクリックできる)。
    // 矢印はほぼ水平なので、画面座標で一定の太さの半透明バンドをオーバーレイ層に重ねる
    // (図の縮小率に依らず確実に太く見え、フローチャートのエッジと同等の操作感になる)。
    if (el.kind === "message" && el.lineEl) {
      const r = el.lineEl.getBoundingClientRect();
      const band = document.createElement("div");
      band.className = "hit msg-line-hit";
      band.style.left = `${r.left - overlayRect.left}px`;
      band.style.top = `${r.top + r.height / 2 - MSG_BAND_PX / 2 - overlayRect.top}px`;
      band.style.width = `${r.width}px`;
      band.style.height = `${MSG_BAND_PX}px`;
      band.title = `${el.id}: クリックでメニュー`;
      overlayEl.append(band);
      wire(band, el, () => el.lineEl!.getBoundingClientRect());
    }

    const rect = el.el.getBoundingClientRect();
    const hit = document.createElement("div");
    hit.className = "hit";
    hit.style.left = `${rect.left - overlayRect.left}px`;
    hit.style.top = `${rect.top - overlayRect.top}px`;
    hit.style.width = `${rect.width}px`;
    hit.style.height = `${rect.height}px`;
    hit.title = `${el.id}: クリックでメニュー / ダブルクリックでラベル編集`;
    overlayEl.append(hit);
    wire(hit, el, () => el.el.getBoundingClientRect());
  }
}

/**
 * クリックの画面 y から、その位置に挿入するメッセージの直前 (上) に来る
 * メッセージ要素の id を返す。クリックがどのメッセージより上なら null。
 */
function insertionAnchor(elements: readonly EditableElement[], clientY: number): string | null {
  const msgs = elements
    .filter((e) => e.kind === "message" && e.lineEl)
    .map((e) => ({ id: e.id, y: e.lineEl!.getBoundingClientRect().top }))
    .sort((a, b) => a.y - b.y);
  let anchor: string | null = null;
  for (const m of msgs) {
    if (m.y < clientY) anchor = m.id;
    else break;
  }
  return anchor;
}

/** エッジパスに重ねる、透明で太いクリック用パスを作る */
function makeEdgeHit(path: SVGGraphicsElement): SVGPathElement {
  const hit = document.createElementNS(SVGNS, "path");
  hit.setAttribute("d", path.getAttribute("d") ?? "");
  hit.setAttribute("fill", "none");
  hit.setAttribute("stroke", "transparent");
  hit.setAttribute("stroke-width", String(EDGE_HIT_WIDTH));
  hit.setAttribute("stroke-linecap", "round");
  hit.classList.add("edge-hit");
  return hit;
}

/** パスの中点をビューポート座標の (幅 0 の) 矩形として返す */
function midpointClientRect(path: SVGGraphicsElement): DOMRect {
  const geom = path as SVGPathElement;
  try {
    const p = geom.getPointAtLength(geom.getTotalLength() / 2);
    const ctm = geom.getScreenCTM();
    if (ctm) {
      const dp = new DOMPoint(p.x, p.y).matrixTransform(ctm);
      return new DOMRect(dp.x, dp.y, 0, 0);
    }
  } catch {
    // getPointAtLength 非対応時は外接矩形で代用
  }
  return path.getBoundingClientRect();
}
