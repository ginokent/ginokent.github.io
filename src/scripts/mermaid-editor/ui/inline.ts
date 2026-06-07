import type { EditableElement } from "../core/types";

// インライン編集: 選択要素の上に入力欄を重ね、単一フィールドを直接編集する。
// ダブルクリック (ラベル) およびメニュー項目選択から呼ばれる。

export interface EditCallbacks {
  /** 変更されたフィールド (name → 新値) を適用する */
  onApply(el: EditableElement, changes: Record<string, string>): void;
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

  const input = document.createElement("input");
  input.className = "inline-input";
  input.style.left = `${anchor.left - hostRect.left}px`;
  input.style.top = `${anchor.top - hostRect.top}px`;
  input.style.width = `${Math.max(anchor.width, 60)}px`;
  input.style.height = `${anchor.height}px`;
  input.value = field.value;

  let done = false;
  const close = () => {
    if (done) return;
    done = true;
    input.remove();
  };
  const commit = () => {
    if (done) return;
    const value = input.value;
    done = true;
    input.remove();
    if (value !== field.value) cb.onApply(el, { [fieldName]: value });
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
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
  return close;
}
