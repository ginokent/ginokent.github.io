// コンテキストメニュー: 任意のアクション項目を縦に並べるポップオーバー。

export interface MenuAction {
  label: string;
  onSelect: () => void;
  disabled?: boolean; // true なら選択不可。グレーアウトして表示し onSelect は呼ばない
  note?: string; // ラベル下に常時表示する補足 (無効化の理由など)。スマホでも見えるようツールチップにしない
}

/** ラベルと (あれば) 補足を item に流し込む */
function fillItem(item: HTMLElement, action: MenuAction): void {
  const label = document.createElement("span");
  label.textContent = action.label;
  item.append(label);
  if (action.note) {
    const note = document.createElement("small");
    note.className = "menu-item__note";
    note.textContent = action.note;
    item.append(note);
  }
}

/** アクション一覧のメニューを host に開く。閉じる関数を返す */
export function openMenu(
  host: HTMLElement,
  anchor: DOMRect,
  hostRect: DOMRect,
  actions: readonly MenuAction[],
): () => void {
  const menu = document.createElement("div");
  menu.className = "menu";

  for (const action of actions) {
    // 無効項目は div で描画する (button だと一部ブラウザで操作・表示が不安定)。
    // 無効化の理由は note としてラベル下に常時表示し、ホバー前提のツールチップは
    // スマホで見えないため使わない
    if (action.disabled) {
      const item = document.createElement("div");
      item.className = "menu-item menu-item--disabled";
      item.setAttribute("aria-disabled", "true");
      fillItem(item, action);
      menu.append(item);
      continue;
    }
    const item = document.createElement("button");
    item.type = "button";
    item.className = "menu-item";
    fillItem(item, action);
    item.addEventListener("click", () => {
      close();
      action.onSelect();
    });
    menu.append(item);
  }

  let closed = false;
  const onOutside = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  function close(): void {
    if (closed) return;
    closed = true;
    document.removeEventListener("mousedown", onOutside);
    document.removeEventListener("keydown", onKey);
    menu.remove();
  }

  setTimeout(() => {
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onKey);
  }, 0);

  host.append(menu);
  positionWithin(menu, anchor, hostRect);
  return close;
}

/**
 * メニューを表示領域 (hostRect) 内に収める。
 * 下に出すとはみ出す場合は上へ反転し、左右もはみ出さないようクランプする。
 */
function positionWithin(menu: HTMLElement, anchor: DOMRect, hostRect: DOMRect): void {
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  const GAP = 6;

  let top = anchor.bottom - hostRect.top + GAP; // 既定は下
  if (top + h > hostRect.height) {
    const above = anchor.top - hostRect.top - h - GAP;
    top = above >= 0 ? above : Math.max(0, hostRect.height - h);
  }
  const left = Math.max(0, Math.min(anchor.left - hostRect.left, hostRect.width - w));

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}
