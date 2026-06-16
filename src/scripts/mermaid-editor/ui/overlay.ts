import { defaultLocale, getMessages, type Messages } from "../core/i18n";
import { hasActivationMarker, type BlockType, type EditableElement, type NotePlacement } from "../core/types";
import { openInlineEditor } from "./inline";
import { openMenu, type MenuAction } from "./menu";

// オーバーレイ層: SVG の上に当たり判定を重ねる。
//   - ノード等  : HTML の透明 div ヒット
//   - エッジ    : SVG 上に重ねる透明で太いパス (線全体をクリックしやすく)
// 操作:
//   - 左クリック       → ライフライン (縦線) だけはその高さを起点に「矢印を伸ばす」モードへ直接入る。
//                        それ以外の要素 (ノード/アクター/メッセージ/ノート/エッジ/ブロック/タイトル等)
//                        はメニューを開く
//   - 右クリック/長押し → メニュー (主に PC は右クリック、スマホは長押し)
//   - ダブルクリック   → ラベルを直接インライン編集
//   - 選択モード       → 対象のクリックで確定 (矢印追加 / 再接続 / ブロックで囲む 等)

const SVGNS = "http://www.w3.org/2000/svg";
const DBLCLICK_DELAY = 220; // ms
const LONGPRESS_MS = 500; // 長押しでメニューを開くまでの時間 (スマホ用)
const EDGE_HIT_WIDTH = 16; // エッジのクリック可能領域の太さ (SVG ユーザー単位)
const MSG_BAND_PX = 18; // メッセージ矢印のクリック帯の太さ (画面ピクセル)
const LIFELINE_BAND_PX = 14; // ライフライン (縦線) のクリック帯の太さ (画面ピクセル)

// 表示名は実行時に Messages から引く。ここでは構造データ (括弧・演算子) と
// 翻訳キーだけを持つ (図種固有の構造は図種に依らず不変なので静的に保つ)。

/** ノード形状の候補 (翻訳キー → 括弧) */
const SHAPE_CHOICES: ReadonlyArray<{ key: keyof Messages["shape"]; open: string; close: string }> = [
  { key: "rect", open: "[", close: "]" },
  { key: "rounded", open: "(", close: ")" },
  { key: "stadium", open: "([", close: "])" },
  { key: "circle", open: "((", close: "))" },
  { key: "rhombus", open: "{", close: "}" },
  { key: "hexagon", open: "{{", close: "}}" },
  { key: "subroutine", open: "[[", close: "]]" },
  { key: "cylinder", open: "[(", close: ")]" },
];

/** エッジの線種候補 (翻訳キー → リンク演算子) */
const EDGE_TYPES: ReadonlyArray<{ key: keyof Messages["edgeType"]; op: string }> = [
  { key: "solidArrow", op: "-->" },
  { key: "dottedArrow", op: "-.->" },
  { key: "thickArrow", op: "==>" },
  { key: "solidLine", op: "---" },
  { key: "endX", op: "--x" },
  { key: "endO", op: "--o" },
];

/** メッセージの矢印種別候補 (翻訳キー → 矢印演算子) */
const MESSAGE_ARROWS: ReadonlyArray<{ key: keyof Messages["messageArrow"]; op: string }> = [
  { key: "solidArrow", op: "->>" },
  { key: "dottedArrow", op: "-->>" },
  { key: "solidLine", op: "->" },
  { key: "dottedLine", op: "-->" },
  { key: "endX", op: "-x" },
  { key: "async", op: "-)" },
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
  onAddEdgeLabel(el: EditableElement): void;
  onReconnectMessage(el: EditableElement, end: "from" | "to", actorId: string): void;
  onSetActivation(el: EditableElement, sign: string): void;
  onAddNote(placement: NotePlacement, actorIds: string[], anchorId: string | null): void;
  onSetNotePlacement(el: EditableElement, placement: NotePlacement, actorIds: string[]): void;
  onWrapBlock(from: EditableElement, to: EditableElement, type: BlockType): void;
  onUnwrapBlock(el: EditableElement): void;
  onSetBlockType(el: EditableElement, type: BlockType): void;
  onAddBranch(el: EditableElement): void;
  onMoveLine(el: EditableElement, dir: "up" | "down"): void;
}

// 1 文 = 1 行で並び替えられる要素の種別。ブロック (複数行) や lifeline (文ではない) は除く
const MOVABLE_KINDS: ReadonlySet<EditableElement["kind"]> = new Set([
  "node",
  "edge",
  "actor",
  "message",
  "note",
]);

/** 制御ブロックの種別候補。表示名は実行時に Messages から引く */
const BLOCK_TYPES: ReadonlyArray<BlockType> = ["alt", "opt", "loop", "par"];

export function drawOverlay(
  overlayEl: HTMLElement,
  stageEl: HTMLElement,
  elements: readonly EditableElement[],
  cb: OverlayCallbacks,
  msg: Messages = getMessages(defaultLocale),
): void {
  // フィールド編集メニューのラベル ("<フィールド名> を編集")。
  // フィールド表示名は Messages から引き、未知のフィールドは名前をそのまま使う
  const editLabel = (name: string): string => msg.editField(msg.field[name as keyof Messages["field"]] ?? name);
  overlayEl.replaceChildren();
  // ヒット div は overlay の子なので、overlay 自身の矩形を原点に配置する。
  // stage には border/padding があり、overlay は (inset:0 で) stage のパディングボックスを
  // 基準にするため、stage の矩形基準だと border 分 (1px) 右下へずれてしまう。
  const overlayRect = overlayEl.getBoundingClientRect();
  // メニュー・入力欄も overlay の子。開く瞬間にライブ計測することで、描画後にページが
  // スクロールしても anchor (ライブ取得) と座標系が揃い、ずれない。描画時に 1 度だけ
  // 取得した stage 矩形を基準にすると、スクロール量がそのまま位置ずれになっていた
  const hostRect = () => overlayEl.getBoundingClientRect();
  const svg = stageEl.querySelector("svg");

  // 開いているメニュー / 入力欄は 1 つに限定する
  let active: (() => void) | null = null;
  const setActive = (close: () => void) => {
    active?.();
    active = close;
  };

  // 操作モード: 要素選択 (pickActor) / ノート配置 (placeNote) / ブロック終点の高さ指定 (wrapEnd)。
  // Esc または枠外 (ヒット以外) のクリックで取消できる。
  type Pending =
    | { kind: "pickActor"; accept: (el: EditableElement) => boolean; onPick: (refId: string) => void }
    | { kind: "pickEl"; accept: (el: EditableElement) => boolean; onPick: (el: EditableElement) => void }
    | { kind: "placeNote"; placement: NotePlacement; actorIds: string[] }
    | { kind: "wrapEnd"; y1: number; type: BlockType };
  let pending: Pending | null = null;
  let pickSource: Element | null = null;
  let hint: HTMLElement | null = null;
  let startMark: HTMLElement | null = null; // 「メッセージを追加」起点 (ここから矢印が伸びる) の目印
  // 長押しでメニューを開いた直後に発火する click を 1 回だけ無視するためのフラグ。
  // 長押し (touch) はタイマー満了後 touchend で click も発火させるため、これを抑止しないと
  // メニューを開いた上に「矢印モード」へ入ってしまう
  let suppressClick = false;
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
    startMark?.remove();
    startMark = null;
    window.clearTimeout(outsideTimer);
    document.removeEventListener("keydown", onPickKey);
    document.removeEventListener("click", onOutsideClick);
  }
  // mark は起点の画面座標 (viewport)。あれば「ここから矢印が伸びる」目印を overlay に置く
  function beginPending(p: Pending, hintText: string, source?: Element, mark?: { x: number; y: number }): void {
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
    if (mark) {
      startMark = document.createElement("div");
      startMark.className = "pick-start";
      // overlay 矩形はライブ計測する (hostRect)。描画時に取得した overlayRect を使うと、
      // mark は click 時のライブ client 座標なので、描画後のスクロール分だけ ○ がクリック位置
      // からずれる (メニュー/入力欄と同じ理由で配置基準の座標系を揃える)
      const host = hostRect();
      startMark.style.left = `${mark.x - host.left}px`;
      startMark.style.top = `${mark.y - host.top}px`;
      overlayEl.append(startMark);
    }
    document.addEventListener("keydown", onPickKey);
    // 開始のクリック自身を拾わないよう、枠外クリック検知は次のティックで登録する
    outsideTimer = window.setTimeout(() => document.addEventListener("click", onOutsideClick), 0);
  }
  const startPickActor = (
    hintText: string,
    accept: (el: EditableElement) => boolean,
    onPick: (refId: string) => void,
    source?: Element,
    mark?: { x: number; y: number },
  ) => beginPending({ kind: "pickActor", accept, onPick }, hintText, source, mark);
  const startPlaceNote = (placement: NotePlacement, actorIds: string[], hintText: string, source?: Element) =>
    beginPending({ kind: "placeNote", placement, actorIds }, hintText, source);
  // refId を持たない要素 (メッセージ等) を選ばせる。ブロックで囲む終端メッセージの指定に使う
  const startPickEl = (
    hintText: string,
    accept: (el: EditableElement) => boolean,
    onPick: (el: EditableElement) => void,
    source?: Element,
  ) => beginPending({ kind: "pickEl", accept, onPick }, hintText, source);
  // ブロックで囲む: 始点の高さ y1 を持ち、終点の高さをライフライン/要素クリックで指定させる
  const startWrapEnd = (y1: number, type: BlockType, source?: Element) =>
    beginPending({ kind: "wrapEnd", y1, type }, msg.hint.wrapEndHeight, source);

  /** pickActor 中にクリックされた要素を送信先候補として確定/取消する */
  const resolvePick = (el: EditableElement): void => {
    if (pending?.kind !== "pickActor") return;
    const ok = pending.accept(el) && el.refId !== undefined;
    const { onPick } = pending;
    cancelPending();
    if (ok) onPick(el.refId!);
  };

  /** pickEl 中にクリックされた要素を確定/取消する (要素そのものを渡す) */
  const resolvePickEl = (el: EditableElement): void => {
    if (pending?.kind !== "pickEl") return;
    const ok = pending.accept(el);
    const { onPick } = pending;
    cancelPending();
    if (ok) onPick(el);
  };

  const edit = (el: EditableElement, fieldName: string, anchor: () => DOMRect) =>
    setActive(openInlineEditor(overlayEl, anchor(), hostRect(), el, fieldName, cb));

  const hasLabel = (el: EditableElement) => el.fields.some((f) => f.name === "label");
  const isNode = (el: EditableElement) => el.kind === "node";
  // メッセージの送信先は、アクターの箱でも縦線 (lifeline) でも選べる
  const isActorTarget = (el: EditableElement) => el.kind === "actor" || el.kind === "lifeline";

  const actionsFor = (el: EditableElement, anchor: () => DOMRect, hitEl: Element): MenuAction[] => {
    if (el.kind === "edge") {
      const a: MenuAction[] = [];
      if (hasLabel(el)) a.push({ label: editLabel("label"), onSelect: () => edit(el, "label", anchor) });
      else a.push({ label: msg.menu.addLabel, onSelect: () => cb.onAddEdgeLabel(el) });
      a.push({
        label: msg.menu.changeEdgeSource,
        onSelect: () =>
          startPickActor(msg.hint.pickNewEdgeSource, isNode, (id) => cb.onApply(el, { from: id })),
      });
      a.push({
        label: msg.menu.changeEdgeTarget,
        onSelect: () =>
          startPickActor(msg.hint.pickNewEdgeTarget, isNode, (id) => cb.onApply(el, { to: id })),
      });
      if (el.operatorRange) {
        a.push({
          label: msg.menu.changeEdgeType,
          onSelect: () =>
            setActive(
              openMenu(
                overlayEl,
                anchor(),
                hostRect(),
                EDGE_TYPES.map((t) => ({ label: msg.edgeType[t.key], onSelect: () => cb.onSetOperator(el, t.op) })),
              ),
            ),
        });
      }
      if (el.endpoints) a.push({ label: msg.menu.reverseArrow, onSelect: () => cb.onReverse(el) });
      addMove(a, el);
      addRemove(a, el);
      return a;
    }
    // branchN (ブロックの else/and ラベル) は専用サブメニューで扱うため一覧からは除く
    const a: MenuAction[] = el.fields
      .filter((f) => !f.name.startsWith("branch"))
      .map((f) => ({
        label: editLabel(f.name),
        onSelect: () => edit(el, f.name, anchor),
      }));
    if (el.kind === "node") {
      a.push({
        label: msg.menu.arrowToNewNode,
        onSelect: () => cb.onAddConnectedNode(el.refId!),
      });
      a.push({
        label: msg.menu.arrowToExistingNode,
        onSelect: () =>
          startPickActor(msg.hint.pickEdgeTargetFrom(el.refId!), isNode, (to) => cb.onAddEdge(el.refId!, to), hitEl),
      });
      if (el.shapeRanges) {
        a.push({
          label: msg.menu.changeShape,
          onSelect: () => setActive(openMenu(overlayEl, anchor(), hostRect(), shapeActions(el))),
        });
      }
    }
    if (el.kind === "actor" && el.refId) {
      a.push({
        label: msg.menu.addMessage,
        onSelect: () => {
          // 起点はこのアクターの箱の下端中央 (ここから矢印が伸びる)
          const r = anchor();
          startPickActor(
            msg.hint.pickMessageTargetFrom(el.refId!),
            isActorTarget,
            (to) => cb.onAddMessage(el.refId!, to),
            hitEl,
            { x: r.left + r.width / 2, y: r.bottom },
          );
        },
      });
      a.push({
        label: msg.menu.addNote,
        onSelect: () => setActive(openMenu(overlayEl, anchor(), hostRect(), noteActions(el.refId!, hitEl))),
      });
    }
    if (el.kind === "message") {
      if (el.operatorRange) {
        a.push({
          label: msg.menu.changeType,
          onSelect: () =>
            setActive(
              openMenu(
                overlayEl,
                anchor(),
                hostRect(),
                MESSAGE_ARROWS.map((t) => ({ label: msg.messageArrow[t.key], onSelect: () => cb.onSetOperator(el, t.op) })),
              ),
            ),
        });
      }
      if (el.activationRange) {
        a.push({
          label: msg.menu.activation,
          onSelect: () =>
            setActive(
              openMenu(overlayEl, anchor(), hostRect(), [
                { label: msg.menu.activate, onSelect: () => cb.onSetActivation(el, "+") },
                { label: msg.menu.deactivate, onSelect: () => cb.onSetActivation(el, "-") },
                { label: msg.menu.clearActivation, onSelect: () => cb.onSetActivation(el, "") },
              ]),
            ),
        });
      }
      if (el.endpoints) {
        // 活性化マーカー ([+-]) 付きは反転すると活性化/非活性化の対応が崩れて
        // mermaid が不正になるため、グレーアウトして理由をツールチップで示す
        a.push(
          hasActivationMarker(el)
            ? {
                label: msg.menu.reverseArrow,
                onSelect: () => {},
                disabled: true,
                note: msg.menu.reverseDisabledNote,
              }
            : { label: msg.menu.reverseArrow, onSelect: () => cb.onReverse(el) },
        );
        // 送信元/送信先のアクターを別のアクターに付け替える (フローチャートのエッジ再接続と同等)。
        // 活性化マーカー ([+-]) 付きは付け替えると起動/終了の対応が崩れるため反転と同様に無効化する
        const reconnect = (label: string, end: "from" | "to", who: string): MenuAction =>
          hasActivationMarker(el)
            ? { label, onSelect: () => {}, disabled: true, note: msg.menu.reconnectDisabledNote }
            : {
                label,
                onSelect: () =>
                  startPickActor(msg.hint.pickReconnectActor(who), isActorTarget, (id) => cb.onReconnectMessage(el, end, id), hitEl),
              };
        a.push(reconnect(msg.menu.changeFrom, "from", msg.menu.sourceNoun));
        a.push(reconnect(msg.menu.changeTo, "to", msg.menu.targetNoun));
      }
      addWrapInBlock(a, el, anchor, hitEl);
    }
    if (el.kind === "block" && el.block) {
      const block = el.block;
      a.push({
        label: msg.menu.changeType,
        onSelect: () => setActive(openMenu(overlayEl, anchor(), hostRect(), blockTypeActions(el))),
      });
      // 分岐 (else/and) の追加は alt/par のみ。分岐ラベルの編集はラベル自体 (kind "branch")
      // を直接クリックして行う (sectionTitle にアンカーするため入力欄が正しい位置に出る)
      if (block.type === "alt") a.push({ label: msg.menu.addElse, onSelect: () => cb.onAddBranch(el) });
      else if (block.type === "par") a.push({ label: msg.menu.addAnd, onSelect: () => cb.onAddBranch(el) });
      a.push({ label: msg.menu.unwrapBlock, onSelect: () => cb.onUnwrapBlock(el) });
    }
    if (el.kind === "note" && el.placementRange) {
      a.push({
        label: msg.menu.changePlacement,
        onSelect: () => setActive(openMenu(overlayEl, anchor(), hostRect(), notePlacementActions(el))),
      });
      addWrapInBlock(a, el, anchor, hitEl);
    }
    addMove(a, el);
    addRemove(a, el);
    return a;
  };

  // ノートの配置変更: 配置を選び、対象アクター (箱か縦線) をクリックして確定する
  const notePlacementActions = (el: EditableElement): MenuAction[] => {
    const pickOne = (placement: NotePlacement) =>
      startPickActor(msg.hint.pickNoteActor, isActorTarget, (id) =>
        cb.onSetNotePlacement(el, placement, [id]),
      );
    return [
      { label: msg.menu.placeRight, onSelect: () => pickOne("right") },
      { label: msg.menu.placeLeft, onSelect: () => pickOne("left") },
      { label: msg.menu.placeOverOne, onSelect: () => pickOne("over") },
      {
        label: msg.menu.spanTwoNote,
        onSelect: () =>
          startPickActor(msg.hint.pickFirstActor, isActorTarget, (first) =>
            startPickActor(msg.hint.pickSecondActor, isActorTarget, (second) =>
              cb.onSetNotePlacement(el, "over", [first, second]),
            ),
          ),
      },
    ];
  };

  const shapeActions = (el: EditableElement): MenuAction[] =>
    SHAPE_CHOICES.map((s) => ({
      label: msg.shape[s.key],
      onSelect: () => cb.onSetShape(el, s.open, s.close),
    }));

  // ブロック種別の変更候補。現在種別は無効表示。分岐があると opt/loop は
  // else/and を持てないため、理由を添えてグレーアウトする (非互換変更の抑止)。
  const blockTypeActions = (el: EditableElement): MenuAction[] => {
    const block = el.block!;
    const hasBranches = block.branches.length > 0;
    const branchKw = hasBranches ? block.branches[0].keyword : "";
    return BLOCK_TYPES.map((type) => {
      const name = msg.blockType[type];
      if (type === block.type) return { label: msg.menu.currentLabel(name), onSelect: () => {}, disabled: true };
      if (hasBranches && type !== "alt" && type !== "par") {
        return { label: name, onSelect: () => {}, disabled: true, note: msg.menu.branchExistsNote(branchKw) };
      }
      return { label: name, onSelect: () => cb.onSetBlockType(el, type) };
    });
  };

  // ノート配置の選択。選んだ後にライフライン上の高さをクリックして位置を決める。
  // 「2 者にまたがる」は相手アクターを選んでから高さを指定する。
  const noteActions = (actorId: string, hitEl: Element): MenuAction[] => {
    const place = (placement: NotePlacement, ids: string[], where: string) =>
      startPlaceNote(placement, ids, msg.hint.placeNoteHeight(where), hitEl);
    return [
      { label: msg.menu.placeRight, onSelect: () => place("right", [actorId], msg.menu.rightOf(actorId)) },
      { label: msg.menu.placeLeft, onSelect: () => place("left", [actorId], msg.menu.leftOf(actorId)) },
      { label: msg.menu.placeOver, onSelect: () => place("over", [actorId], msg.menu.over(actorId)) },
      {
        label: msg.menu.spanTwoActors,
        onSelect: () =>
          startPickActor(
            msg.hint.pickSpanPartner(actorId),
            isActorTarget,
            (other) => place("over", [actorId, other], `${actorId},${other}`),
            hitEl,
          ),
      },
    ];
  };

  // ライフラインのクリック位置 (anchorId) を使い、その高さへ直接ノートを追加するサブメニュー。
  // アクターメニュー経由 (noteActions) と違い、高さは既に決まっているので再クリック不要。
  const lifelineNoteActions = (actorId: string, anchorId: string | null, source: Element): MenuAction[] => [
    { label: msg.menu.placeRight, onSelect: () => cb.onAddNote("right", [actorId], anchorId) },
    { label: msg.menu.placeLeft, onSelect: () => cb.onAddNote("left", [actorId], anchorId) },
    { label: msg.menu.placeOver, onSelect: () => cb.onAddNote("over", [actorId], anchorId) },
    {
      label: msg.menu.spanTwoActors,
      onSelect: () =>
        startPickActor(
          msg.hint.pickSpanPartner(actorId),
          isActorTarget,
          (other) => cb.onAddNote("over", [actorId, other], anchorId),
          source,
        ),
    },
  ];

  function addRemove(actions: MenuAction[], el: EditableElement): void {
    if (el.removeLines && el.removeLines.length > 0) {
      actions.push({ label: msg.menu.delete, onSelect: () => cb.onRemove(el) });
    }
  }

  // 並び替え (1 文 = 1 行の入れ替え)。端や図ヘッダ際では editor 側が no-op で弾く
  function addMove(actions: MenuAction[], el: EditableElement): void {
    if (!MOVABLE_KINDS.has(el.kind) || !el.removeLines || el.removeLines.length === 0) return;
    actions.push({ label: msg.menu.moveUp, onSelect: () => cb.onMoveLine(el, "up") });
    actions.push({ label: msg.menu.moveDown, onSelect: () => cb.onMoveLine(el, "down") });
  }

  // 始点をこの要素とし、終端の要素 (メッセージ/ノート) をクリックで指定して囲む。
  // wrapInBlockEdits は行範囲で動くため、メッセージ・ノートいずれも (混在でも) 囲める
  const isWrappable = (e: EditableElement) => e.kind === "message" || e.kind === "note";
  function addWrapInBlock(actions: MenuAction[], el: EditableElement, anchor: () => DOMRect, hitEl: Element): void {
    actions.push({
      label: msg.menu.wrapInBlock,
      onSelect: () =>
        setActive(
          openMenu(
            overlayEl,
            anchor(),
            hostRect(),
            BLOCK_TYPES.map((type) => ({
              label: msg.blockType[type],
              onSelect: () =>
                startPickEl(
                  msg.hint.pickWrapEnd(msg.blockType[type]),
                  isWrappable,
                  (to) => cb.onWrapBlock(el, to, type),
                  hitEl,
                ),
            })),
          ),
        ),
    });
  }

  // 要素 (メッセージ/ノート) の画面上の高さ。当たり判定はメッセージは矢印線、ノートは箱
  const wrappableY = (e: EditableElement): number =>
    (e.kind === "message" && e.lineEl ? e.lineEl : e.el).getBoundingClientRect().top;

  // 2 つの高さ (y1, y2) の間にある wrappable 要素のうち最上と最下を返す (無ければ null)
  const wrapRangeBetween = (y1: number, y2: number): { from: EditableElement; to: EditableElement } | null => {
    const lo = Math.min(y1, y2);
    const hi = Math.max(y1, y2);
    const inRange = elements
      .filter(isWrappable)
      .map((e) => ({ e, y: wrappableY(e) }))
      .filter(({ y }) => y >= lo && y <= hi)
      .sort((a, b) => a.y - b.y);
    if (inRange.length === 0) return null;
    return { from: inRange[0].e, to: inRange[inRange.length - 1].e };
  };

  // wrapEnd 中に終点の高さ y2 が決まったら、始点との間の範囲を囲む
  const resolveWrapEnd = (y2: number): void => {
    if (pending?.kind !== "wrapEnd") return;
    const { y1, type } = pending;
    cancelPending();
    const range = wrapRangeBetween(y1, y2);
    if (range) cb.onWrapBlock(range.from, range.to, type);
  };

  // ライフライン用: 種別を選び、始点 (このクリック高さ y1) と終点の高さの間を囲む。
  // 矢印を直接クリックしなくても、高さ (どのメッセージの上/下か) で範囲を指定できる
  function addWrapRange(actions: MenuAction[], y1: number, anchorRect: DOMRect, source: Element): void {
    actions.push({
      label: msg.menu.wrapInBlock,
      onSelect: () =>
        setActive(
          openMenu(
            overlayEl,
            anchorRect,
            hostRect(),
            BLOCK_TYPES.map((type) => ({ label: msg.blockType[type], onSelect: () => startWrapEnd(y1, type, source) })),
          ),
        ),
    });
  }

  // 右クリック / 長押し でメニュー (open) を開くトリガーを要素に張る。open はイベント発生位置
  // (clientX, clientY) を受け取る (ライフライン等、高さでメニュー内容が変わる要素のため)。
  // 長押し満了後の click は suppressClick で 1 回無視し、矢印モードへ入らないようにする。
  const attachContextTriggers = (target: Element, open: (clientX: number, clientY: number) => void): void => {
    target.addEventListener("contextmenu", (ev: Event) => {
      const e = ev as MouseEvent;
      e.preventDefault();
      if (pending) {
        cancelPending(); // ピック中の右クリックは取消 (Esc 相当)
        return;
      }
      open(e.clientX, e.clientY);
    });
    let pressTimer: number | undefined;
    target.addEventListener(
      "touchstart",
      (ev: Event) => {
        const t = (ev as TouchEvent).touches[0];
        const x = t?.clientX ?? 0;
        const y = t?.clientY ?? 0;
        suppressClick = false;
        pressTimer = window.setTimeout(() => {
          suppressClick = true; // 後続の click が矢印モードを誤発火しないよう抑止
          if (pending) {
            cancelPending();
            return;
          }
          open(x, y);
        }, LONGPRESS_MS);
      },
      { passive: true },
    );
    const cancelPress = () => window.clearTimeout(pressTimer);
    target.addEventListener("touchmove", cancelPress);
    target.addEventListener("touchend", cancelPress);
    target.addEventListener("touchcancel", cancelPress);
  };

  // 左クリックの主作用: ライフライン (専用ハンドラ) だけが「矢印を伸ばす」モードに直接入る。
  // それ以外の要素 (ノード/アクター/メッセージ/ノート/エッジ/ブロック/タイトル等) は左クリックで
  // メニューを開く。矢印追加はメニュー (「既存ノードへ矢印」「メッセージを追加」等) から行う。

  const wire = (hitEl: Element, el: EditableElement, anchor: () => DOMRect) => {
    let clickTimer: number | undefined;
    hitEl.addEventListener("click", () => {
      if (pending) {
        // pickActor/pickEl 中はこの要素を候補に。placeNote 中の非ライフラインは取消
        if (pending.kind === "pickActor") resolvePick(el);
        else if (pending.kind === "pickEl") resolvePickEl(el);
        // wrapEnd 中: 矢印/ノートのクリックでもその高さを終点にできる (ライフライン以外でも可)
        else if (pending.kind === "wrapEnd" && isWrappable(el)) resolveWrapEnd(wrappableY(el));
        else cancelPending();
        return;
      }
      if (suppressClick) {
        suppressClick = false; // 長押しメニュー直後の click を 1 回無視する
        return;
      }
      window.clearTimeout(clickTimer);
      // dblclick (ラベル直編集) と両立させるため、確定は DBLCLICK_DELAY 後に行う
      clickTimer = window.setTimeout(
        () => setActive(openMenu(overlayEl, anchor(), hostRect(), actionsFor(el, anchor, hitEl))),
        DBLCLICK_DELAY,
      );
    });
    hitEl.addEventListener("dblclick", () => {
      window.clearTimeout(clickTimer);
      if (pending) return;
      // 表示テキストのフィールド (label / title) を直接編集する
      const f = el.fields.find((x) => x.name === "label" || x.name === "title");
      if (f) edit(el, f.name, anchor);
    });
    // 右クリック / 長押し でメニュー
    attachContextTriggers(hitEl, () => setActive(openMenu(overlayEl, anchor(), hostRect(), actionsFor(el, anchor, hitEl))));
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
      band.title = msg.title.lifeline(from);
      // クリック高さ y からこの縦線を起点にメッセージ送信先をピックさせる (ここから矢印が伸びる)
      const startLifelineMessage = (clientY: number) => {
        const anchorId = insertionAnchor(elements, clientY);
        const lineRect = el.el.getBoundingClientRect();
        const startAt = { x: lineRect.left + lineRect.width / 2, y: clientY };
        startPickActor(
          msg.hint.pickLifelineTarget(from),
          isActorTarget,
          (to) => cb.onInsertMessage(from, to, anchorId),
          band,
          startAt,
        );
      };
      // 右クリック / 長押し用メニュー: メッセージ追加・ノート追加・ブロックで囲む。
      // いずれもイベント発生位置の高さ (anchorId) をその位置として使う
      const openLifelineMenuAt = (clientX: number, clientY: number) => {
        const anchorId = insertionAnchor(elements, clientY);
        const at = pointRect(clientX, clientY);
        const menu: MenuAction[] = [
          { label: msg.menu.addMessage, onSelect: () => startLifelineMessage(clientY) },
          {
            label: msg.menu.addNote,
            onSelect: () => setActive(openMenu(overlayEl, at, hostRect(), lifelineNoteActions(from, anchorId, band))),
          },
        ];
        // ブロックで囲む: このクリック高さを始点に、終点の高さをもう一度クリックして範囲を囲む
        addWrapRange(menu, clientY, at, band);
        setActive(openMenu(overlayEl, at, hostRect(), menu));
      };
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
        // ブロックで囲む終点の高さ指定中は、この縦線のクリック高さを終点にする
        if (pending?.kind === "wrapEnd") {
          resolveWrapEnd((e as MouseEvent).clientY);
          return;
        }
        // その他のピック中 (pickEl 等) はライフラインを対象外とし取消する
        if (pending) {
          cancelPending();
          return;
        }
        if (suppressClick) {
          suppressClick = false; // 長押しメニュー直後の click を 1 回無視する
          return;
        }
        // 縦線の左クリックはこの高さを起点にメッセージ送信先をピックする (矢印を伸ばすモード)。
        // ライフラインにはラベル直編集 (dblclick) が無いので遅延せず即座に開始する
        startLifelineMessage((e as MouseEvent).clientY);
      });
      // 右クリック / 長押し でメニュー (メッセージ/ノート/ブロックで囲む)
      attachContextTriggers(band, openLifelineMenuAt);
      overlayEl.append(band);
      continue;
    }

    if (el.fields.length === 0) continue; // 編集不可要素はスキップ

    if (el.kind === "edge") {
      if (!svg) continue;
      const hit = makeEdgeHit(el.el);
      svg.append(hit);
      wire(hit, el, () => midpointClientRect(el.el));
      // ラベル (g.edgeLabel) もエッジのクリック領域にする。クリックでエッジと同じメニュー、
      // ダブルクリックでラベル編集 (入力欄はラベルの位置に出る)
      for (const labelEl of el.extraHits ?? []) {
        const r = labelEl.getBoundingClientRect();
        const lhit = document.createElement("div");
        lhit.className = "hit";
        lhit.style.left = `${r.left - overlayRect.left}px`;
        lhit.style.top = `${r.top - overlayRect.top}px`;
        lhit.style.width = `${r.width}px`;
        lhit.style.height = `${r.height}px`;
        lhit.title = msg.title.menuAndDblclick(el.id);
        overlayEl.append(lhit);
        wire(lhit, el, () => labelEl.getBoundingClientRect());
      }
      continue;
    }

    // el 本体 + 追加要素 (折り返した行・ブロックの alt タブ等) の外接矩形。
    // ホバー枠・メニュー・ラベル編集欄の anchor に使う (ライブ計測)
    const hitEls: SVGGraphicsElement[] = [el.el, ...(el.extraHits ?? [])];
    const bounds = () => unionRect(hitEls);

    // メッセージは矢印線にもクリック領域を張る (ラベルだけでなく線をクリックできる)。
    // 矢印はほぼ水平なので、画面座標で一定の太さの半透明バンドをオーバーレイ層に重ねる
    // (図の縮小率に依らず確実に太く見え、フローチャートのエッジと同等の操作感になる)。
    if (el.kind === "message" && el.lineEl) {
      const lr = el.lineEl.getBoundingClientRect();
      const band = document.createElement("div");
      band.className = "hit msg-line-hit";
      band.style.left = `${lr.left - overlayRect.left}px`;
      band.style.top = `${lr.top + lr.height / 2 - MSG_BAND_PX / 2 - overlayRect.top}px`;
      band.style.width = `${lr.width}px`;
      band.style.height = `${MSG_BAND_PX}px`;
      band.title = msg.title.menuOnly(el.id);
      overlayEl.append(band);
      // 帯の anchor は矢印線でなくラベル (bounds)。矢印をダブルクリックしても入力欄が
      // ラベルの位置に出る (矢印位置に出てズレるのを防ぐ)
      wire(band, el, bounds);
    }

    // ホバー枠が行ごとに分かれないよう、外接矩形を 1 つのヒット div にまとめる
    const r = bounds();
    const hit = document.createElement("div");
    hit.className = "hit";
    hit.style.left = `${r.left - overlayRect.left}px`;
    hit.style.top = `${r.top - overlayRect.top}px`;
    hit.style.width = `${r.width}px`;
    hit.style.height = `${r.height}px`;
    hit.title = msg.title.menuAndDblclick(el.id);
    overlayEl.append(hit);
    wire(hit, el, bounds);
  }
}

/** 複数要素の外接矩形 (画面座標)。単一要素ならその矩形そのもの */
function unionRect(els: readonly Element[]): DOMRect {
  const rs = els.map((e) => e.getBoundingClientRect());
  const left = Math.min(...rs.map((r) => r.left));
  const top = Math.min(...rs.map((r) => r.top));
  const right = Math.max(...rs.map((r) => r.right));
  const bottom = Math.max(...rs.map((r) => r.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON() {} } as DOMRect;
}

/** クリック地点をアンカーにするための幅 0 の矩形 (メニューの配置基準に使う) */
function pointRect(x: number, y: number): DOMRect {
  return { left: x, top: y, right: x, bottom: y, width: 0, height: 0, x, y, toJSON() {} } as DOMRect;
}

/**
 * クリック Y の直上にある挿入境界要素の id を返す (無ければ null = 先頭)。
 * メッセージ/ノートに加え、ブロックヘッダ (alt 等) と分岐 (else/and) も境界に含める。
 * これにより else 区切り線の下をクリックしたとき、前の分岐の末尾ではなく else の中へ
 * 挿入される (editor 側がヘッダ/分岐の直後に入れる)。
 */
export function insertionAnchor(elements: readonly EditableElement[], clientY: number): string | null {
  const yOf = (e: EditableElement): number | null => {
    if (e.kind === "message") return e.lineEl ? e.lineEl.getBoundingClientRect().top : null;
    if (e.kind === "note" || e.kind === "block" || e.kind === "branch") return e.el.getBoundingClientRect().top;
    return null;
  };
  const cands = elements
    .map((e) => ({ id: e.id, y: yOf(e) }))
    .filter((c): c is { id: string; y: number } => c.y !== null)
    .sort((a, b) => a.y - b.y);
  let anchor: string | null = null;
  for (const c of cands) {
    if (c.y < clientY) anchor = c.id;
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
