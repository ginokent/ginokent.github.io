import { firstKeyword, pickAdapter } from "./core/adapter";
import { applyEdits, buildFieldEdits } from "./core/edit";
import { defaultLocale, getMessages, type Locale, type Messages } from "./core/i18n";
import { History } from "./core/history";
import { copyText, exportPng, exportSvg } from "./core/export";
import { save } from "./core/persist";
import { parseError, renderInto, validate } from "./core/render";
import { tokenizeSequence } from "./core/source/sequence";
import {
  INDENT,
  appendStatement,
  cycleDirectionEdit,
  deleteLines,
  freshNodeId,
  insertStatement,
  lineRangeAt,
  moveLineEdit,
  participantInsertEdit,
  toggleAutonumberEdits,
} from "./core/structure";
import { addBranchEdits, setBlockTypeEdits, unwrapBlockEdits, wrapInBlockEdits } from "./core/source/block";
import { hasActivationMarker, type BlockType, type EditableElement, type NotePlacement, type SourceRange, type TextEdit } from "./core/types";
import { drawOverlay, type OverlayCallbacks } from "./ui/overlay";

// オーケストレータ: テキスト (正本) を中心に 3 モデルを再構築し、
// 編集を surgical に書き戻す。編集履歴は History で一元管理する。

/** ノートの配置句を組み立てる (over X,Y / right of X / left of X) */
function noteHead(placement: NotePlacement, actorIds: string[]): string {
  return placement === "over" ? `over ${actorIds.join(",")}` : `${placement} of ${actorIds[0]}`;
}

export interface EditorElements {
  source: HTMLTextAreaElement; // 正本テキスト
  diagram: HTMLElement; // 図の描画先
  overlay: HTMLElement; // オーバーレイ層
  stage: HTMLElement; // 図 + オーバーレイを内包する基準要素
  error: HTMLElement; // 構文エラー表示
}

export interface EditorOptions {
  /** メニュー・ヒント等の UI 文言のロケール (既定は ja)。親サイトは現在のロケールを渡す */
  locale?: Locale;
}

export class Editor {
  private elements: EditableElement[] = [];
  private overlayActive = false; // オーバーレイが編集モードで表示中か (リサイズ再配置の可否)
  private readonly history = new History();
  private msg: Messages; // オーバーレイへ渡す UI 文言

  constructor(
    private readonly dom: EditorElements,
    /** 図の再構築 (図種変化を含む) ごとに呼ぶ。ツールバーの図種別表示更新に使う */
    private readonly onRender?: () => void,
    options?: EditorOptions,
  ) {
    this.msg = getMessages(options?.locale ?? defaultLocale);
    // テキスト直接編集にも追従し、履歴へ記録する (入力デバウンス)
    let timer: number | undefined;
    dom.source.addEventListener("input", () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        this.history.push(dom.source.value);
        void this.rebuild();
      }, 200);
    });

    // 描画後にウィンドウ/コンテナがリサイズされると SVG がレスポンシブにスケールし、
    // 描画時の座標で固定された当たり判定がずれる。サイズ変化を監視し、図は再描画せず
    // オーバーレイ (当たり判定) だけ現在の SVG 位置へ貼り直す。rAF で連続発火を間引く。
    if (typeof ResizeObserver !== "undefined") {
      let raf: number | undefined;
      const ro = new ResizeObserver(() => {
        if (raf !== undefined) return;
        raf = window.requestAnimationFrame(() => {
          raf = undefined;
          this.redrawOverlay();
        });
      });
      ro.observe(dom.stage);
    }

    // Undo / Redo のキーボードショートカット (テキストエリアの標準 undo も統一)
    window.addEventListener("keydown", (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        void this.undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        void this.redo();
      }
    });
  }

  /** 初期テキストを設定して描画する */
  async setText(text: string): Promise<void> {
    this.dom.source.value = text;
    this.history.reset(text);
    await this.rebuild();
  }

  /** 全文をテンプレート等で置換する (履歴に記録するため Undo で戻せる) */
  async replaceAll(text: string): Promise<void> {
    if (text === this.dom.source.value) return;
    this.dom.source.value = text;
    this.history.push(text);
    await this.rebuild();
  }

  /** mermaid コードをコピーする */
  async copyCode(): Promise<boolean> {
    try {
      await copyText(this.dom.source.value);
      return true;
    } catch {
      console.warn("copy to clipboard failed");
      return false;
    }
  }

  /** SVG を書き出す */
  saveSvg(): void {
    exportSvg(this.dom.diagram);
  }

  /** PNG を書き出す */
  async savePng(): Promise<void> {
    try {
      await exportPng(this.dom.diagram);
    } catch {
      console.warn("png export failed");
    }
  }

  async undo(): Promise<void> {
    const prev = this.history.undo();
    if (prev !== null) await this.applyHistory(prev);
  }

  async redo(): Promise<void> {
    const next = this.history.redo();
    if (next !== null) await this.applyHistory(next);
  }

  /** 履歴の状態をテキストへ反映する (履歴には積まない) */
  private async applyHistory(text: string): Promise<void> {
    this.dom.source.value = text;
    await this.rebuild();
  }

  private showError(message: string): void {
    this.dom.error.textContent = message;
    this.dom.error.hidden = false;
  }

  private clearError(): void {
    this.dom.error.hidden = true;
    this.dom.error.textContent = "";
  }

  /** 現在のテキストから図・モデル・オーバーレイを再構築する */
  private async rebuild(): Promise<void> {
    const text = this.dom.source.value;
    save(text); // 自動保存 + 共有 URL 更新 (無効構文でも作業内容を失わない)
    const err = await parseError(text);
    if (err) {
      // 不正な構文では編集モードに入らず、直前の図を残してエラーを表示する
      this.overlayActive = false;
      this.dom.overlay.replaceChildren();
      this.showError(err);
      this.onRender?.();
      return;
    }
    this.clearError();
    const svg = await renderInto(this.dom.diagram, text);
    const adapter = pickAdapter(text);
    this.elements = adapter ? adapter.build(text, svg) : [];
    this.overlayActive = true;
    drawOverlay(this.dom.overlay, this.dom.stage, this.elements, this.overlayCallbacks(), this.msg);
    this.onRender?.();
  }

  /** UI 文言のロケールを切り替え、オーバーレイ (メニュー・ヒント・title) を貼り直す */
  setLocale(locale: Locale): void {
    this.msg = getMessages(locale);
    this.redrawOverlay();
  }

  /** 現在の図種 (ツールバーの図種別ボタン表示に使う)。未対応図種は null */
  diagramType(): "flowchart" | "sequence" | null {
    const kw = firstKeyword(this.dom.source.value);
    if (kw === "flowchart" || kw === "graph") return "flowchart";
    if (kw === "sequenceDiagram") return "sequence";
    return null;
  }

  /** sequenceDiagram で autonumber が有効か */
  autonumberEnabled(): boolean {
    return /^\s*autonumber\b/mu.test(this.dom.source.value);
  }

  /** autonumber の有効/解除を切り替える (sequence 以外では何もしない) */
  async toggleAutonumber(): Promise<void> {
    if (this.diagramType() !== "sequence") return;
    await this.commitEdits(toggleAutonumberEdits(this.dom.source.value));
  }

  /** 図を再描画せず、現在の要素でオーバーレイ (当たり判定) だけ貼り直す (リサイズ追従) */
  private redrawOverlay(): void {
    if (!this.overlayActive) return; // エラー表示中などは貼り直さない
    drawOverlay(this.dom.overlay, this.dom.stage, this.elements, this.overlayCallbacks(), this.msg);
  }

  /** オーバーレイ操作のコールバック (rebuild / redrawOverlay で共用) */
  private overlayCallbacks(): OverlayCallbacks {
    return {
      onApply: (el, changes) => void this.apply(el, changes),
      onAddEdge: (from, to) => void this.addEdge(from, to),
      onAddConnectedNode: (from) => void this.addConnectedNode(from),
      onAddMessage: (from, to) => void this.addMessage(from, to),
      onInsertMessage: (from, to, anchor) => void this.insertMessage(from, to, anchor),
      onRemove: (el) => void this.remove(el),
      onSetShape: (el, open, close) => void this.setShape(el, open, close),
      onSetOperator: (el, op) => void this.setOperator(el, op),
      onReverse: (el) => void this.reverse(el),
      onAddEdgeLabel: (el) => void this.addEdgeLabel(el),
      onReconnectMessage: (el, end, actorId) => void this.reconnectMessage(el, end, actorId),
      onSetActivation: (el, sign) => void this.setActivation(el, sign),
      onMoveLine: (el, dir) => void this.moveLine(el, dir),
      onWrapBlock: (from, to, type) => void this.wrapInBlock(from, to, type),
      onUnwrapBlock: (el) => void this.unwrapBlock(el),
      onSetBlockType: (el, type) => void this.setBlockType(el, type),
      onAddBranch: (el) => void this.addBranch(el),
      onAddNote: (placement, actorIds, anchor) => void this.addNote(placement, actorIds, anchor),
      onAddNoteAtMessage: (el, position) => void this.addNoteAtMessage(el, position),
      onSetNotePlacement: (el, placement, actorIds) => void this.setNotePlacement(el, placement, actorIds),
    };
  }

  /** 要素を削除する (ノードは接続エッジも巻き込むカスケード削除) */
  private async remove(el: EditableElement): Promise<void> {
    if (!el.removeLines || el.removeLines.length === 0) return;
    await this.commitEdits(deleteLines(this.dom.source.value, el.removeLines));
  }

  /** ツールバーの追加: 図種に応じて主要素 (ノード / 参加者) を追加する */
  async addElement(): Promise<void> {
    if (this.isFlowchart()) await this.addNode();
    else if (this.isSequence()) await this.addParticipant();
  }

  /** 新規ノードを追加する */
  private async addNode(): Promise<void> {
    const ids = this.refIds("node");
    const id = freshNodeId(ids);
    await this.commitEdits([appendStatement(this.dom.source.value, `${id}[新規ノード]`)]);
  }

  /** 新規参加者を追加する */
  private async addParticipant(): Promise<void> {
    // 採番はソースの participant 宣言から行う。アクターは表示名で相関するため
    // refIds("actor") は同名追加で崩れて id が増えない (p1,p2,p1,p2…) ため使わない
    const ids = tokenizeSequence(this.dom.source.value).actors.map((a) => a.id);
    const id = freshNodeId(ids, "p");
    const n = id.slice(1); // "p3" → "3" (表示名も一意にして相関衝突を避ける)
    // 宣言はメッセージの間に紛れないよう既存の participant 宣言群の直後へ挿入する
    await this.commitEdits([
      participantInsertEdit(this.dom.source.value, `participant ${id} as 新規参加者${n}`),
    ]);
  }

  /** 要素の文を 1 行上/下の文と入れ替える (並び替え) */
  async moveLine(el: EditableElement, dir: "up" | "down"): Promise<void> {
    const line = el.removeLines?.[0];
    if (!line) return;
    const edits = moveLineEdit(this.dom.source.value, line, dir);
    if (edits) await this.commitEdits(edits);
  }

  /** from から to へのエッジを追加する */
  async addEdge(fromId: string, toId: string): Promise<void> {
    if (!this.isFlowchart()) return;
    await this.commitEdits([appendStatement(this.dom.source.value, `${fromId} --> ${toId}`)]);
  }

  /** from から新規ノードへ矢印を引く (ノードと辺を 1 文で生成) */
  async addConnectedNode(fromId: string): Promise<void> {
    if (!this.isFlowchart()) return;
    const id = freshNodeId(this.refIds("node"));
    await this.commitEdits([
      appendStatement(this.dom.source.value, `${fromId} --> ${id}[新規ノード]`),
    ]);
  }

  /** from から to へのメッセージを追加する (文末に追記) */
  async addMessage(fromId: string, toId: string): Promise<void> {
    if (!this.isSequence()) return;
    await this.commitEdits([
      appendStatement(this.dom.source.value, `${fromId}->>${toId}: メッセージ`),
    ]);
  }

  /**
   * 指定タイミングにメッセージを挿入する。
   * anchorId は挿入位置の直前 (上) に来るメッセージ要素の id。
   * null なら先頭メッセージの前 (メッセージが無ければ文末) に挿入する。
   */
  async insertMessage(fromId: string, toId: string, anchorId: string | null): Promise<void> {
    if (!this.isSequence()) return;
    await this.insertAtAnchor(`${fromId}->>${toId}: メッセージ`, anchorId);
  }

  /** 指定タイミングにノートを追加する (placement と actorIds で配置を決める) */
  async addNote(placement: NotePlacement, actorIds: string[], anchorId: string | null): Promise<void> {
    if (!this.isSequence() || actorIds.length === 0) return;
    await this.insertAtAnchor(`Note ${noteHead(placement, actorIds)}: メモ`, anchorId);
  }

  /**
   * メッセージの直前 (above) / 直後 (below) に、関与アクターをまたぐノートを追加する。
   * 配置は送信元・送信先をまたぐ `Note over from,to` (自己メッセージは `Note over from`)。
   */
  async addNoteAtMessage(el: EditableElement, position: "above" | "below"): Promise<void> {
    if (!this.isSequence() || el.kind !== "message" || !el.endpoints) return;
    const line = el.removeLines?.[0];
    if (!line) return;
    const text = this.dom.source.value;
    const from = text.slice(el.endpoints.from.start, el.endpoints.from.end);
    const to = text.slice(el.endpoints.to.start, el.endpoints.to.end);
    const actorIds = from === to ? [from] : [from, to];
    const stmt = `Note ${noteHead("over", actorIds)}: メモ`;
    await this.commitEdits([insertStatement(text, line, position === "above" ? "before" : "after", stmt)]);
  }

  /** 既存ノートの配置句 (over X,Y / right of X 等) を置換する */
  async setNotePlacement(el: EditableElement, placement: NotePlacement, actorIds: string[]): Promise<void> {
    if (!el.placementRange || actorIds.length === 0) return;
    await this.commitEdits([{ range: el.placementRange, newText: noteHead(placement, actorIds) }]);
  }

  /** anchorId の要素の直後 (null なら先頭の前、メッセージが無ければ文末) に 1 文挿入する */
  private async insertAtAnchor(stmt: string, anchorId: string | null): Promise<void> {
    const text = this.dom.source.value;
    const el = anchorId ? this.elements.find((e) => e.id === anchorId) : undefined;
    const at = el ? this.anchorInsert(text, el) : undefined;
    let edit: TextEdit;
    if (at) {
      edit = insertStatement(text, at.line, "after", stmt, at.indent);
    } else {
      const first = this.firstMessageRange();
      edit = first ? insertStatement(text, first, "before", stmt) : appendStatement(text, stmt);
    }
    await this.commitEdits([edit]);
  }

  /**
   * 挿入アンカー要素から「直後へ挿入する行」と本文インデントを求める。
   * メッセージ/ノートはその行の直後 (同インデント)。ブロックヘッダ (alt 等) や
   * 分岐 (else/and) はその節の先頭へ入れたいので、ヘッダ/分岐行の直後に 1 段深い
   * インデントで挿入する。これにより else 枠内クリックが else の中へ正しく入る。
   */
  private anchorInsert(text: string, el: EditableElement): { line: SourceRange; indent?: string } | undefined {
    if (el.kind === "message" || el.kind === "note") {
      const line = el.removeLines?.[0];
      return line ? { line } : undefined;
    }
    let offset: number | undefined;
    if (el.kind === "block" && el.block) offset = el.block.headerStart;
    else if (el.kind === "branch") offset = el.fields[0]?.ranges[0]?.start;
    if (offset === undefined) return undefined;
    const line = lineRangeAt(text, offset);
    if (!line) return undefined;
    const lead = /^[ \t]*/u.exec(text.slice(line.start, line.end))?.[0] ?? "";
    return { line, indent: lead + INDENT };
  }

  /** ソース上で最初に現れるメッセージ行の範囲 */
  private firstMessageRange(): SourceRange | undefined {
    return this.elements
      .filter((e) => e.kind === "message" && e.removeLines?.length)
      .map((e) => e.removeLines![0])
      .sort((a, b) => a.start - b.start)[0];
  }

  private refIds(kind: EditableElement["kind"]): string[] {
    return this.elements.filter((e) => e.kind === kind && e.refId).map((e) => e.refId!);
  }

  /** ノードの形状 (括弧) を変更する */
  private async setShape(el: EditableElement, open: string, close: string): Promise<void> {
    if (!el.shapeRanges) return;
    await this.commitEdits([
      { range: el.shapeRanges.open, newText: open },
      { range: el.shapeRanges.close, newText: close },
    ]);
  }

  /** エッジ/メッセージの演算子 (線種・矢印種別) を変更する */
  private async setOperator(el: EditableElement, op: string): Promise<void> {
    if (!el.operatorRange) return;
    await this.commitEdits([{ range: el.operatorRange, newText: op }]);
  }

  /** エッジ/メッセージの向きを反転する (始点と終点の参照を入れ替える) */
  async reverse(el: EditableElement): Promise<void> {
    if (!el.endpoints) return;
    // 活性化マーカー付きは反転不可 (mermaid の活性化対応が崩れて不正になる)。
    // UI 側でもグレーアウトしているが、防御的にここでも弾く
    if (hasActivationMarker(el)) return;
    const { from, to } = el.endpoints;
    const text = this.dom.source.value;
    const fromId = text.slice(from.start, from.end);
    const toId = text.slice(to.start, to.end);
    if (fromId === toId) return; // 自己ループ/自己メッセージは反転不要
    await this.commitEdits([
      { range: from, newText: toId },
      { range: to, newText: fromId },
    ]);
  }

  /** ラベルの無いエッジにラベルを追加する (演算子直後に |ラベル| を挿入する) */
  async addEdgeLabel(el: EditableElement): Promise<void> {
    if (!el.operatorRange) return;
    const at = el.operatorRange.end; // 例: A --> B → A -->|ラベル| B
    await this.commitEdits([{ range: { start: at, end: at }, newText: "|ラベル|" }]);
  }

  /** メッセージの起動/終了 ([+-]?) を切り替える (sign は "+"/"-"/"") */
  private async setActivation(el: EditableElement, sign: string): Promise<void> {
    if (!el.activationRange) return;
    await this.commitEdits([{ range: el.activationRange, newText: sign }]);
  }

  /** メッセージの送信元 (from) / 送信先 (to) のアクターを付け替える */
  async reconnectMessage(el: EditableElement, end: "from" | "to", actorId: string): Promise<void> {
    if (!el.endpoints) return;
    // 活性化マーカー付きは付け替えると起動/終了の対応が崩れて不正になる。
    // UI 側でもグレーアウトしているが、防御的にここでも弾く (反転と同じ扱い)
    if (hasActivationMarker(el)) return;
    await this.commitEdits([{ range: el.endpoints[end], newText: actorId }]);
  }

  /** 2 つのメッセージ (始点・終点) を制御ブロックで囲む */
  async wrapInBlock(from: EditableElement, to: EditableElement, type: BlockType): Promise<void> {
    const fromLine = from.removeLines?.[0];
    const toLine = to.removeLines?.[0];
    if (!fromLine || !toLine) return;
    const edits = wrapInBlockEdits(this.dom.source.value, fromLine, toLine, type);
    if (!edits) return; // well-nested でない範囲は無視 (commitEdits の検証でも弾かれる)
    await this.commitEdits(edits);
  }

  /** 制御ブロックの囲みを解除する (中身は 1 段デデントして残す) */
  async unwrapBlock(el: EditableElement): Promise<void> {
    if (!el.block) return;
    await this.commitEdits(unwrapBlockEdits(this.dom.source.value, el.block.headerStart));
  }

  /** 制御ブロックの種別 (loop/alt/opt/par) を変更する */
  async setBlockType(el: EditableElement, type: BlockType): Promise<void> {
    if (!el.block) return;
    await this.commitEdits(setBlockTypeEdits(this.dom.source.value, el.block.headerStart, type));
  }

  /** 制御ブロック (alt/par) に分岐 (else/and) を追加する */
  async addBranch(el: EditableElement): Promise<void> {
    if (!el.block) return;
    await this.commitEdits(addBranchEdits(this.dom.source.value, el.block.headerStart));
  }

  /** フローチャートの方向を TD→LR→RL→BT で切り替える */
  async cycleDirection(): Promise<void> {
    if (!this.isFlowchart()) return;
    const edit = cycleDirectionEdit(this.dom.source.value);
    if (edit) await this.commitEdits([edit]);
  }

  /** 変更フィールドを結合 TextEdit に変換して適用する */
  async apply(el: EditableElement, changes: Record<string, string>): Promise<void> {
    await this.commitEdits(buildFieldEdits(el.fields, changes));
  }

  private isFlowchart(): boolean {
    const kw = firstKeyword(this.dom.source.value);
    return kw === "flowchart" || kw === "graph";
  }

  private isSequence(): boolean {
    return firstKeyword(this.dom.source.value) === "sequenceDiagram";
  }

  /**
   * TextEdit 群を適用して書き戻し、再構築する。
   * 適用後テキストが不正な構文になる編集 (無効な ID へのリネーム等) は
   * 破棄して元のテキストを保つ。
   */
  private async commitEdits(edits: readonly TextEdit[]): Promise<void> {
    if (edits.length === 0) return;
    const newText = applyEdits(this.dom.source.value, edits);
    if (newText === this.dom.source.value) return;
    if (!(await validate(newText))) {
      console.warn("edit rejected: result is not valid mermaid syntax");
      return;
    }
    this.dom.source.value = newText;
    this.history.push(newText);
    await this.rebuild();
  }
}
