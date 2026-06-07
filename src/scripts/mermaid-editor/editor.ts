import { firstKeyword, pickAdapter } from "./core/adapter";
import { applyEdits, buildFieldEdits } from "./core/edit";
import { History } from "./core/history";
import { copyText, exportPng, exportSvg } from "./core/export";
import { save } from "./core/persist";
import { parseError, renderInto, validate } from "./core/render";
import { tokenizeSequence } from "./core/source/sequence";
import {
  appendStatement,
  cycleDirectionEdit,
  deleteLines,
  freshNodeId,
  insertStatement,
} from "./core/structure";
import type { EditableElement, NotePlacement, SourceRange, TextEdit } from "./core/types";
import { drawOverlay } from "./ui/overlay";

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

export class Editor {
  private elements: EditableElement[] = [];
  private readonly history = new History();

  constructor(private readonly dom: EditorElements) {
    // テキスト直接編集にも追従し、履歴へ記録する (入力デバウンス)
    let timer: number | undefined;
    dom.source.addEventListener("input", () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        this.history.push(dom.source.value);
        void this.rebuild();
      }, 200);
    });

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
      this.dom.overlay.replaceChildren();
      this.showError(err);
      return;
    }
    this.clearError();
    const svg = await renderInto(this.dom.diagram, text);
    const adapter = pickAdapter(text);
    this.elements = adapter ? adapter.build(text, svg) : [];
    drawOverlay(this.dom.overlay, this.dom.stage, this.elements, {
      onApply: (el, changes) => void this.apply(el, changes),
      onAddEdge: (from, to) => void this.addEdge(from, to),
      onAddConnectedNode: (from) => void this.addConnectedNode(from),
      onAddMessage: (from, to) => void this.addMessage(from, to),
      onInsertMessage: (from, to, anchor) => void this.insertMessage(from, to, anchor),
      onRemove: (el) => void this.remove(el),
      onSetShape: (el, open, close) => void this.setShape(el, open, close),
      onSetOperator: (el, op) => void this.setOperator(el, op),
      onReverse: (el) => void this.reverse(el),
      onSetActivation: (el, sign) => void this.setActivation(el, sign),
      onAddNote: (placement, actorIds, anchor) => void this.addNote(placement, actorIds, anchor),
      onSetNotePlacement: (el, placement, actorIds) => void this.setNotePlacement(el, placement, actorIds),
    });
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
    await this.commitEdits([
      appendStatement(this.dom.source.value, `participant ${id} as 新規参加者${n}`),
    ]);
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

  /** 既存ノートの配置句 (over X,Y / right of X 等) を置換する */
  async setNotePlacement(el: EditableElement, placement: NotePlacement, actorIds: string[]): Promise<void> {
    if (!el.placementRange || actorIds.length === 0) return;
    await this.commitEdits([{ range: el.placementRange, newText: noteHead(placement, actorIds) }]);
  }

  /** anchorId のメッセージ直後 (null なら先頭の前、メッセージが無ければ文末) に 1 文挿入する */
  private async insertAtAnchor(stmt: string, anchorId: string | null): Promise<void> {
    const text = this.dom.source.value;
    const after = anchorId ? this.elements.find((e) => e.id === anchorId)?.removeLines?.[0] : undefined;
    let edit: TextEdit;
    if (after) {
      edit = insertStatement(text, after, "after", stmt);
    } else {
      const first = this.firstMessageRange();
      edit = first ? insertStatement(text, first, "before", stmt) : appendStatement(text, stmt);
    }
    await this.commitEdits([edit]);
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

  /** メッセージの起動/終了 ([+-]?) を切り替える (sign は "+"/"-"/"") */
  private async setActivation(el: EditableElement, sign: string): Promise<void> {
    if (!el.activationRange) return;
    await this.commitEdits([{ range: el.activationRange, newText: sign }]);
  }

  /** フローチャートの方向を TD→LR→RL→BT で切り替える */
  async cycleDirection(): Promise<void> {
    if (!this.isFlowchart()) return;
    const edit = cycleDirectionEdit(this.dom.source.value);
    if (edit) await this.commitEdits([edit]);
  }

  /** 変更フィールドを結合 TextEdit に変換して適用する */
  private async apply(el: EditableElement, changes: Record<string, string>): Promise<void> {
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
