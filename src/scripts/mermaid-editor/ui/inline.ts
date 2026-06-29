import type { EditableElement } from "../core/types";

// インライン編集: 選択要素の上に入力欄を重ね、単一フィールドを直接編集する。
// ダブルクリック (ラベル) およびメニュー項目選択から呼ばれる。
//
// ラベル (fieldName === "label") は複数行編集を許す。Shift+Enter で改行を挿入し、
// 確定時に改行を <br/> へ変換して書き戻す。編集開始時は逆に <br/> を改行へ戻して表示する。
// id 等の識別子は単一行のまま (改行は不可)。

export interface EditCallbacks {
  /** 変更されたフィールド (name → 新値) を適用する */
  onApply(el: EditableElement, changes: Record<string, string>): void;
}

const BR_RE = /<br\s*\/?>/giu; // <br> / <br/> / <br /> いずれも対象

/** 入力欄の生成オプション (フィールド非依存の低レベル API) */
export interface InputOptions {
  initial: string; // 初期値 (multiline のとき <br/> を含み得る)
  multiline: boolean; // true でラベル相当 (改行可・<br/> 変換あり)
  onCommit: (value: string) => void; // 表示が変わったときだけ呼ぶ (multiline は <br/> 形へ戻した値)
}

/**
 * host 上に入力欄を重ね、確定で onCommit を呼ぶ低レベル API。閉じる関数を返す。
 * 表示が変わらなければ onCommit は呼ばない (no-op)。エッジラベルの新規入力など、
 * 既存フィールドが無いケースでも使える (空確定 = onCommit("") で削除を表現できる)。
 */
export function openInput(host: HTMLElement, anchor: DOMRect, hostRect: DOMRect, opts: InputOptions): () => void {
  const { initial, multiline, onCommit } = opts;
  const input = document.createElement(multiline ? "textarea" : "input") as HTMLTextAreaElement | HTMLInputElement;
  input.className = "inline-input";
  input.style.left = `${anchor.left - hostRect.left}px`;
  input.style.top = `${anchor.top - hostRect.top}px`;
  input.style.width = `${Math.max(anchor.width, 60)}px`;

  // 表示は <br/> を実改行に、書き戻しは実改行を <br/> に変換する
  const toDisplay = (v: string) => (multiline ? v.replace(BR_RE, "\n") : v);
  const toSource = (v: string) => (multiline ? v.replace(/\r?\n/gu, "<br/>") : v);
  input.value = toDisplay(initial);

  // textarea は内容に合わせて高さを伸ばす (input は要素の高さに合わせる)
  const autoGrow = () => {
    input.style.height = "auto";
    input.style.height = `${Math.max(input.scrollHeight, anchor.height)}px`;
  };
  if (multiline) input.addEventListener("input", autoGrow);
  else input.style.height = `${anchor.height}px`;

  let done = false;
  const close = () => {
    if (done) return;
    done = true;
    input.remove();
  };
  const commit = () => {
    if (done) return;
    const raw = input.value;
    done = true;
    input.remove();
    // 表示テキストが変わったときだけ書き戻す (<br> 形の差異だけでは書き換えない)
    if (raw !== toDisplay(initial)) onCommit(toSource(raw));
  };

  input.addEventListener("keydown", (ev: Event) => {
    const e = ev as KeyboardEvent;
    // IME 変換中 (日本語などの確定 Enter) は無視する。確定/取消で誤って閉じないため
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter") {
      if (multiline && e.shiftKey) return; // Shift+Enter は改行を挿入 (textarea の既定動作)
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });
  input.addEventListener("blur", commit);

  host.append(input);
  input.focus();
  input.select();
  if (multiline) autoGrow();
  return close;
}

/** 要素の指定フィールドをインライン編集する。閉じる関数を返す */
export function openInlineEditor(
  host: HTMLElement,
  anchor: DOMRect,
  hostRect: DOMRect,
  el: EditableElement,
  fieldName: string,
  cb: EditCallbacks,
): () => void {
  const field = el.fields.find((f) => f.name === fieldName);
  if (!field) return () => {};
  return openInput(host, anchor, hostRect, {
    initial: field.value,
    multiline: fieldName === "label", // ラベルだけ改行可。id 等は単一行
    onCommit: (value) => cb.onApply(el, { [fieldName]: value }),
  });
}
