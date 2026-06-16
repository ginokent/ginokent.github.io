// コンテキストメニュー: 任意のアクション項目を縦に並べるポップオーバー。
// children を持つ項目はカスケード式サブメニューになる:
//   - 親にホバーすると子メニューが横へ即時フライアウトする (親は残る・transient)
//   - 親をクリック (スマホはタップ) すると子を固定する (マウスを離しても開いたまま)
//   - 別の親へ移ると切り替わり、葉の選択 / 外側クリック / Esc で全階層を閉じる

export interface MenuAction {
  label: string;
  onSelect?: () => void; // 葉のとき実行する。children を持つ親では省略する
  children?: readonly MenuAction[]; // サブメニュー。あればカスケードで展開する
  disabled?: boolean; // true なら選択不可。グレーアウトして表示し onSelect は呼ばない
  note?: string; // ラベル下に常時表示する補足 (無効化の理由など)。スマホでも見えるようツールチップにしない
}

// 親項目を離れてから子メニューへマウスを移すまでの猶予。transient のときのみ、この時間
// 内に子へ入らなければ閉じる (pinned は閉じない)。
const SUBMENU_CLOSE_GRACE_MS = 100;

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

/** 構築済みの 1 階層メニュー (子のフライアウトも含めた開閉を司る) */
interface LiveMenu {
  el: HTMLDivElement;
  contains(node: Node): boolean; // 自身または開いている子孫に node を含むか
  destroy(): void; // 自身と開いている子をすべて取り除く
}

/** アクション一覧のメニューを host に開く。閉じる関数を返す */
export function openMenu(
  host: HTMLElement,
  anchor: DOMRect,
  hostRect: DOMRect,
  actions: readonly MenuAction[],
): () => void {
  let closed = false;
  let root: LiveMenu;

  function closeAll(): void {
    if (closed) return;
    closed = true;
    document.removeEventListener("mousedown", onOutside);
    document.removeEventListener("keydown", onKey);
    root.destroy();
  }
  const onOutside = (e: MouseEvent): void => {
    if (!root.contains(e.target as Node)) closeAll();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") closeAll();
  };

  root = buildMenu(actions, host, hostRect, closeAll);
  host.append(root.el);
  positionWithin(root.el, anchor, hostRect);

  setTimeout(() => {
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onKey);
  }, 0);

  return closeAll;
}

/**
 * 1 階層分のメニューを構築する。children を持つ項目はホバー (即時) で子を transient に開き、
 * クリックで pinned にする。子は host の子として兄弟配置し、再帰でさらに深い階層も扱う。
 */
function buildMenu(
  actions: readonly MenuAction[],
  host: HTMLElement,
  hostRect: DOMRect,
  closeAll: () => void,
): LiveMenu {
  const menu = document.createElement("div");
  menu.className = "menu";

  // この階層で現在開いている子は高々 1 つ。pinned は「マウスを離しても閉じない」状態。
  let open: { item: HTMLElement; live: LiveMenu; pinned: boolean } | null = null;
  let closeTimer: number | undefined;

  const cancelScheduledClose = (): void => {
    if (closeTimer !== undefined) {
      clearTimeout(closeTimer);
      closeTimer = undefined;
    }
  };
  const closeChild = (): void => {
    cancelScheduledClose();
    if (open) {
      open.item.classList.remove("is-open");
      open.live.destroy();
      open = null;
    }
  };
  const scheduleCloseChild = (): void => {
    cancelScheduledClose();
    closeTimer = window.setTimeout(() => {
      if (open && !open.pinned) closeChild();
    }, SUBMENU_CLOSE_GRACE_MS);
  };
  const openChild = (item: HTMLElement, childActions: readonly MenuAction[], pin: boolean): void => {
    cancelScheduledClose();
    if (open && open.item === item) {
      if (pin) open.pinned = true; // 既に開いている子をクリックで固定に昇格する
      return;
    }
    closeChild(); // 別の子が開いていれば (pinned でも) 切り替える
    const live = buildMenu(childActions, host, hostRect, closeAll);
    host.append(live.el);
    positionFlyout(live.el, item.getBoundingClientRect(), hostRect);
    // 親項目→子メニューの隙間をまたぐ間も transient を閉じないよう、子の上でも猶予を制御する
    live.el.addEventListener("mouseenter", cancelScheduledClose);
    live.el.addEventListener("mouseleave", scheduleCloseChild);
    item.classList.add("is-open");
    open = { item, live, pinned: pin };
  };

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

    if (action.children && action.children.length > 0) {
      const childActions = action.children;
      item.classList.add("menu-item--parent");
      item.setAttribute("aria-haspopup", "true");
      // ホバーで即時に子を開く (transient)。離れると猶予後に閉じる
      item.addEventListener("mouseenter", () => openChild(item, childActions, false));
      item.addEventListener("mouseleave", scheduleCloseChild);
      // クリック (スマホはタップ) で子を固定する。親クリックではメニューを閉じない
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        openChild(item, childActions, true);
      });
    } else {
      item.addEventListener("click", () => {
        closeAll();
        action.onSelect?.();
      });
    }
    menu.append(item);
  }

  return {
    el: menu,
    contains(node: Node): boolean {
      return menu.contains(node) || (open?.live.contains(node) ?? false);
    },
    destroy(): void {
      closeChild();
      menu.remove();
    },
  };
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

/**
 * サブメニューを親項目の横にフライアウトさせる。既定は右、右に収まらなければ左へ反転し、
 * 上下は親項目の上端に揃えつつ領域内にクランプする。
 */
function positionFlyout(menu: HTMLElement, itemRect: DOMRect, hostRect: DOMRect): void {
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  const GAP = 2;

  let left = itemRect.right - hostRect.left + GAP; // 既定は右
  if (left + w > hostRect.width) {
    const leftSide = itemRect.left - hostRect.left - w - GAP;
    left = leftSide >= 0 ? leftSide : Math.max(0, hostRect.width - w);
  }
  let top = itemRect.top - hostRect.top;
  if (top + h > hostRect.height) top = Math.max(0, hostRect.height - h);

  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(0, top)}px`;
}
