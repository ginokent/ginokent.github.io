// 国際化 (i18n): UI 文言の翻訳を一箇所に集約する。
//
// 方針:
//   - 対応言語は ja (既定) / en の 2 言語。親サイト ginokent.github.io の
//     Astro i18n (defaultLocale: ja / locales: [ja, en]) と揃える。
//   - i18n ライブラリは追加しない (SPEC.md §13 最小依存)。プレーンな辞書で実装する。
//   - 翻訳対象は UI 文言のみ。図ソースへ挿入される既定文言 (新規ノード / メッセージ /
//     メモ等) とテンプレート本文は内容なので翻訳しない (常に既定のまま)。
//   - ロジック層 (editor.ts / overlay.ts) はこのモジュールの Messages を受け取って
//     描画する。親サイトは現在のロケール (Astro.currentLocale) を渡せばよい。
//   - 言語の自動判定・永続化はスタンドアロン版 (main.ts) のみが使う。親サイトは
//     パスベース (/en/) でロケールが決まるため、これらは呼ばない。

export const locales = ["ja", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "ja";

/** localStorage に言語選択を保存するキー (永続化はスタンドアロン版のみ) */
export const LOCALE_STORAGE_KEY = "mermaid-editor:locale";

/** ブロック種別キー (core/types の BlockType と一致) */
type BlockTypeKey = "alt" | "opt" | "loop" | "par";

/** UI 文言の翻訳。文字列は固定文言、関数は埋め込みのある文言 */
export interface Messages {
  /** フィールド表示名 (label / id / title) */
  field: Record<"label" | "id" | "title", string>;
  /** 「<フィールド名> を編集」メニューのラベルを組み立てる */
  editField: (fieldLabel: string) => string;

  /** ノード形状の表示名 */
  shape: Record<"rect" | "rounded" | "stadium" | "circle" | "rhombus" | "hexagon" | "subroutine" | "cylinder", string>;
  /** フローチャートのエッジ線種の表示名 */
  edgeType: Record<"solidArrow" | "dottedArrow" | "thickArrow" | "solidLine" | "endX" | "endO", string>;
  /** シーケンスのメッセージ矢印種別の表示名 */
  messageArrow: Record<"solidArrow" | "dottedArrow" | "solidLine" | "dottedLine" | "endX" | "async", string>;
  /** 制御ブロック種別の表示名 */
  blockType: Record<BlockTypeKey, string>;
  /** テンプレートボタンの表示名 (templates.ts の key で引く) */
  templateLabel: Record<string, string>;

  /** メニュー項目のラベル */
  menu: {
    addLabel: string;
    changeEdgeSource: string;
    changeEdgeTarget: string;
    changeEdgeType: string;
    reverseArrow: string;
    arrowToNewNode: string;
    arrowToExistingNode: string;
    changeShape: string;
    addToSubgraph: string;
    newSubgraph: string;
    addMessage: string;
    addNote: string;
    addNoteAbove: string;
    addNoteBelow: string;
    changeType: string;
    activation: string;
    activate: string;
    deactivate: string;
    clearActivation: string;
    reverseDisabledNote: string;
    reconnectDisabledNote: string;
    changeFrom: string;
    changeTo: string;
    sourceNoun: string;
    targetNoun: string;
    addElse: string;
    addAnd: string;
    unwrapBlock: string;
    changePlacement: string;
    placeRight: string;
    placeLeft: string;
    placeOver: string;
    placeOverOne: string;
    spanTwoActors: string;
    spanTwoNote: string;
    wrapInBlock: string;
    delete: string;
    moveUp: string;
    moveDown: string;
    /** 種別変更メニューで現在の種別に付ける表示 (例: 「alt (条件分岐) (現在)」) */
    currentLabel: (name: string) => string;
    /** 分岐があり種別変更できない理由 (キーワードは else / and) */
    branchExistsNote: (keyword: string) => string;
    /** ノート配置の位置説明 (右 / 左 / 重ね) */
    rightOf: (id: string) => string;
    leftOf: (id: string) => string;
    over: (id: string) => string;
  };

  /** ピック中などに表示するヒント文言 (末尾は「(Esc で取消)」相当) */
  hint: {
    pickNewEdgeSource: string;
    pickNewEdgeTarget: string;
    pickEdgeTargetFrom: (from: string) => string;
    pickMessageTargetFrom: (from: string) => string;
    pickReconnectActor: (who: string) => string;
    pickNoteActor: string;
    pickFirstActor: string;
    pickSecondActor: string;
    placeNoteHeight: (where: string) => string;
    pickSpanPartner: (id: string) => string;
    pickLifelineTarget: (from: string) => string;
    pickWrapEnd: (typeName: string) => string;
    wrapEndHeight: string;
  };

  /** 当たり判定 div の title 属性。先頭は必ず "<id>: " で始める (テスト・操作で id 前方一致するため) */
  title: {
    lifeline: (id: string) => string;
    menuAndDblclick: (id: string) => string;
    menuOnly: (id: string) => string;
  };

  /** スタンドアロン版 (index.html / main.ts) のページ枠・ツールバー文言 */
  chrome: {
    subtitle: string;
    sourceTitle: string;
    diagramTitle: string;
    add: string;
    addTitle: string;
    direction: string;
    directionTitle: string;
    autonumber: (on: boolean) => string;
    autonumberTitle: string;
    undo: string;
    undoTitle: string;
    redo: string;
    redoTitle: string;
    copy: string;
    copyTitle: string;
    copyDone: string;
    copyFailed: string;
    svg: string;
    svgTitle: string;
    png: string;
    pngTitle: string;
    share: string;
    shareTitle: string;
    shareDone: string;
    templatesLabel: string;
    templateButtonTitle: (label: string) => string;
    templateConfirm: (label: string) => string;
    /** 言語切替ボタンに出す「切り替え先」の言語名 */
    otherLangName: string;
    langToggleTitle: string;
  };
}

/** 半角英数で終わる名前の後ろに半角スペースを足す (全角・半角の間の空け方を揃える) */
function jaSpace(base: string): string {
  return /[A-Za-z0-9]$/u.test(base) ? `${base} ` : base;
}

const ja: Messages = {
  field: { label: "ラベル", id: "ID", title: "タイトル" },
  editField: (f) => `${jaSpace(f)}を編集`,
  shape: {
    rect: "矩形",
    rounded: "角丸",
    stadium: "スタジアム",
    circle: "円",
    rhombus: "ひし形",
    hexagon: "六角形",
    subroutine: "サブルーチン",
    cylinder: "円柱",
  },
  edgeType: {
    solidArrow: "実線矢印",
    dottedArrow: "点線矢印",
    thickArrow: "太線矢印",
    solidLine: "実線 (矢印なし)",
    endX: "終端 x",
    endO: "終端 o",
  },
  messageArrow: {
    solidArrow: "実線矢印",
    dottedArrow: "点線矢印",
    solidLine: "実線 (矢印なし)",
    dottedLine: "点線 (矢印なし)",
    endX: "終端 x",
    async: "非同期 )",
  },
  blockType: {
    alt: "alt (条件分岐)",
    opt: "opt (任意)",
    loop: "loop (繰り返し)",
    par: "par (並行)",
  },
  templateLabel: { sequence: "シーケンス図", flowchart: "フローチャート" },
  menu: {
    addLabel: "ラベルを追加",
    changeEdgeSource: "接続元を変更",
    changeEdgeTarget: "接続先を変更",
    changeEdgeType: "線種を変更 ▸",
    reverseArrow: "矢印の向きを入れ替える",
    arrowToNewNode: "新規ノードへ矢印",
    arrowToExistingNode: "既存ノードへ矢印",
    changeShape: "形状を変更 ▸",
    addToSubgraph: "サブグラフに追加 ▸",
    newSubgraph: "新規作成",
    addMessage: "メッセージを追加",
    addNote: "ノートを追加 ▸",
    addNoteAbove: "上に追加",
    addNoteBelow: "下に追加",
    changeType: "種別を変更 ▸",
    activation: "アクティベーション ▸",
    activate: "対象を起動 (+)",
    deactivate: "対象を終了 (−)",
    clearActivation: "起動/終了を解除",
    reverseDisabledNote: "活性化マーカー (+/-) 付きは反転できません",
    reconnectDisabledNote: "活性化マーカー (+/-) 付きは変更できません",
    changeFrom: "送信元を変更",
    changeTo: "送信先を変更",
    sourceNoun: "送信元",
    targetNoun: "送信先",
    addElse: "else を追加",
    addAnd: "and を追加",
    unwrapBlock: "ブロックを解除 (囲みを残さない)",
    changePlacement: "配置を変更 ▸",
    placeRight: "右側に",
    placeLeft: "左側に",
    placeOver: "重ねる",
    placeOverOne: "重ねる (1 つ)",
    spanTwoActors: "2 者にまたがる ▸",
    spanTwoNote: "またぐ (2 つ) ▸",
    wrapInBlock: "ブロックで囲む ▸",
    delete: "削除",
    moveUp: "1 行上に移動",
    moveDown: "1 行下に移動",
    currentLabel: (name) => `${name} (現在)`,
    branchExistsNote: (kw) => `${kw} 分岐があるため変更できません`,
    rightOf: (id) => `${id} の右`,
    leftOf: (id) => `${id} の左`,
    over: (id) => `${id} 上`,
  },
  hint: {
    pickNewEdgeSource: "新しい接続元のノードをクリック (Esc で取消)",
    pickNewEdgeTarget: "新しい接続先のノードをクリック (Esc で取消)",
    pickEdgeTargetFrom: (from) => `${from} から接続先のノードをクリック (Esc で取消)`,
    pickMessageTargetFrom: (from) => `${from} から相手のアクター (箱か縦線) をクリック (Esc で取消)`,
    pickReconnectActor: (who) => `新しい${who}のアクター (箱か縦線) をクリック (Esc で取消)`,
    pickNoteActor: "ノートを置くアクター (箱か縦線) をクリック (Esc で取消)",
    pickFirstActor: "1 人目のアクター (箱か縦線) をクリック (Esc で取消)",
    pickSecondActor: "2 人目のアクター (箱か縦線) をクリック (Esc で取消)",
    placeNoteHeight: (where) => `${where}のノートを置く高さをライフライン上でクリック (Esc で取消)`,
    pickSpanPartner: (id) => `${id} とまたぐ相手のアクター (箱か縦線) をクリック (Esc で取消)`,
    pickLifelineTarget: (from) => `${from} からの送信先 (アクターの箱か縦線) をクリック (Esc で取消)`,
    pickWrapEnd: (typeName) => `${typeName} で囲む終端の要素 (メッセージかノート) をクリック (Esc で取消)`,
    wrapEndHeight: "囲む終点の高さをライフライン (またはメッセージ/ノート) でクリック (Esc で取消)",
  },
  title: {
    lifeline: (id) => `${id}: 左クリックでこの位置からメッセージ / 右クリック・長押しでメニュー`,
    menuAndDblclick: (id) => `${id}: クリックでメニュー / ダブルクリックでラベル編集`,
    menuOnly: (id) => `${id}: クリックでメニュー`,
  },
  chrome: {
    subtitle: "縦線を左クリックで矢印を伸ばす、要素を右クリック / 長押しでメニュー、ダブルクリックでラベルを直接編集 (戦略 B: 範囲保持書き戻し)",
    sourceTitle: "Mermaid テキスト",
    diagramTitle: "図 (縦線左クリック: 矢印 / 右クリック・長押し: メニュー / ダブルクリック: ラベル)",
    add: "＋ 追加",
    addTitle: "要素を追加 (flowchart: ノード / sequence: 参加者)",
    direction: "⟲ 向き",
    directionTitle: "方向を切替 (flowchart: TD→LR→RL→BT)",
    autonumber: (on) => `① 連番 ${on ? "オン" : "オフ"}`,
    autonumberTitle: "連番 (autonumber) の有効/解除を切り替える",
    undo: "↶ Undo",
    undoTitle: "元に戻す (Ctrl/Cmd+Z)",
    redo: "↷ Redo",
    redoTitle: "やり直す (Ctrl/Cmd+Shift+Z)",
    copy: "⧉ コピー",
    copyTitle: "mermaid コードをコピー",
    copyDone: "コピーしました",
    copyFailed: "コピー失敗",
    svg: "SVG",
    svgTitle: "SVG を書き出す",
    png: "PNG",
    pngTitle: "PNG を書き出す",
    share: "🔗 共有",
    shareTitle: "共有 URL をコピー",
    shareDone: "URL をコピー",
    templatesLabel: "テンプレート:",
    templateButtonTitle: (label) => `${label} のテンプレートで全文を置換`,
    templateConfirm: (label) => `「${label}」のテンプレートで置換しますか？\n現在の内容は失われます (Undo で戻せます)`,
    otherLangName: "English",
    langToggleTitle: "言語を切り替える",
  },
};

const en: Messages = {
  field: { label: "Label", id: "ID", title: "Title" },
  editField: (f) => `Edit ${f}`,
  shape: {
    rect: "Rectangle",
    rounded: "Rounded",
    stadium: "Stadium",
    circle: "Circle",
    rhombus: "Rhombus",
    hexagon: "Hexagon",
    subroutine: "Subroutine",
    cylinder: "Cylinder",
  },
  edgeType: {
    solidArrow: "Solid arrow",
    dottedArrow: "Dotted arrow",
    thickArrow: "Thick arrow",
    solidLine: "Solid (no arrow)",
    endX: "End x",
    endO: "End o",
  },
  messageArrow: {
    solidArrow: "Solid arrow",
    dottedArrow: "Dotted arrow",
    solidLine: "Solid (no arrow)",
    dottedLine: "Dotted (no arrow)",
    endX: "End x",
    async: "Async )",
  },
  blockType: {
    alt: "alt (conditional)",
    opt: "opt (optional)",
    loop: "loop (repeat)",
    par: "par (parallel)",
  },
  templateLabel: { sequence: "Sequence", flowchart: "Flowchart" },
  menu: {
    addLabel: "Add label",
    changeEdgeSource: "Change source",
    changeEdgeTarget: "Change target",
    changeEdgeType: "Change line style ▸",
    reverseArrow: "Reverse arrow direction",
    arrowToNewNode: "Arrow to new node",
    arrowToExistingNode: "Arrow to existing node",
    changeShape: "Change shape ▸",
    addToSubgraph: "Add to subgraph ▸",
    newSubgraph: "New subgraph",
    addMessage: "Add message",
    addNote: "Add note ▸",
    addNoteAbove: "Add above",
    addNoteBelow: "Add below",
    changeType: "Change type ▸",
    activation: "Activation ▸",
    activate: "Activate (+)",
    deactivate: "Deactivate (−)",
    clearActivation: "Clear activation",
    reverseDisabledNote: "Cannot reverse messages with an activation marker (+/-)",
    reconnectDisabledNote: "Cannot change messages with an activation marker (+/-)",
    changeFrom: "Change sender",
    changeTo: "Change receiver",
    sourceNoun: "sender",
    targetNoun: "receiver",
    addElse: "Add else",
    addAnd: "Add and",
    unwrapBlock: "Remove block (keep contents)",
    changePlacement: "Change placement ▸",
    placeRight: "Right of",
    placeLeft: "Left of",
    placeOver: "Over",
    placeOverOne: "Over (one)",
    spanTwoActors: "Span two actors ▸",
    spanTwoNote: "Span two (note) ▸",
    wrapInBlock: "Wrap in block ▸",
    delete: "Delete",
    moveUp: "Move up one line",
    moveDown: "Move down one line",
    currentLabel: (name) => `${name} (current)`,
    branchExistsNote: (kw) => `Cannot change: has ${kw} branches`,
    rightOf: (id) => `right of ${id}`,
    leftOf: (id) => `left of ${id}`,
    over: (id) => `over ${id}`,
  },
  hint: {
    pickNewEdgeSource: "Click the new source node (Esc to cancel)",
    pickNewEdgeTarget: "Click the new target node (Esc to cancel)",
    pickEdgeTargetFrom: (from) => `Click the target node from ${from} (Esc to cancel)`,
    pickMessageTargetFrom: (from) => `Click the other actor (box or lifeline) from ${from} (Esc to cancel)`,
    pickReconnectActor: (who) => `Click the new ${who} actor (box or lifeline) (Esc to cancel)`,
    pickNoteActor: "Click the actor (box or lifeline) to place the note (Esc to cancel)",
    pickFirstActor: "Click the first actor (box or lifeline) (Esc to cancel)",
    pickSecondActor: "Click the second actor (box or lifeline) (Esc to cancel)",
    placeNoteHeight: (where) => `Click on the lifeline for the height of the ${where} note (Esc to cancel)`,
    pickSpanPartner: (id) => `Click the actor (box or lifeline) to span with ${id} (Esc to cancel)`,
    pickLifelineTarget: (from) => `Click the receiver (actor box or lifeline) from ${from} (Esc to cancel)`,
    pickWrapEnd: (typeName) => `Click the end element (message or note) to wrap in ${typeName} (Esc to cancel)`,
    wrapEndHeight: "Click the wrap end height on a lifeline (or a message/note) (Esc to cancel)",
  },
  title: {
    lifeline: (id) => `${id}: left-click to start a message here / right-click or long-press for menu`,
    menuAndDblclick: (id) => `${id}: click for menu / double-click to edit label`,
    menuOnly: (id) => `${id}: click for menu`,
  },
  chrome: {
    subtitle: "Left-click a lifeline to draw an arrow, right-click / long-press an element for the menu, double-click to edit a label directly (Strategy B: range-preserving write-back)",
    sourceTitle: "Mermaid text",
    diagramTitle: "Diagram (lifeline left-click: arrow / right-click or long-press: menu / double-click: label)",
    add: "＋ Add",
    addTitle: "Add an element (flowchart: node / sequence: participant)",
    direction: "⟲ Direction",
    directionTitle: "Cycle direction (flowchart: TD→LR→RL→BT)",
    autonumber: (on) => `① Autonumber ${on ? "on" : "off"}`,
    autonumberTitle: "Toggle autonumber on/off",
    undo: "↶ Undo",
    undoTitle: "Undo (Ctrl/Cmd+Z)",
    redo: "↷ Redo",
    redoTitle: "Redo (Ctrl/Cmd+Shift+Z)",
    copy: "⧉ Copy",
    copyTitle: "Copy mermaid code",
    copyDone: "Copied",
    copyFailed: "Copy failed",
    svg: "SVG",
    svgTitle: "Export SVG",
    png: "PNG",
    pngTitle: "Export PNG",
    share: "🔗 Share",
    shareTitle: "Copy share URL",
    shareDone: "URL copied",
    templatesLabel: "Templates:",
    templateButtonTitle: (label) => `Replace all with the ${label} template`,
    templateConfirm: (label) => `Replace everything with the "${label}" template?\nThe current content will be lost (you can undo).`,
    otherLangName: "日本語",
    langToggleTitle: "Switch language",
  },
};

const MESSAGES: Record<Locale, Messages> = { ja, en };

/** ロケールに対応する Messages を返す */
export function getMessages(locale: Locale): Messages {
  return MESSAGES[locale];
}

/** 値が対応ロケールか判定する (型ガード) */
export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

/** ブラウザ設定から既定ロケールを推定する (en で始まれば en、それ以外は ja) */
export function detectLocale(): Locale {
  if (typeof navigator === "undefined") return defaultLocale;
  const lang = navigator.language?.toLowerCase() ?? "";
  return lang.startsWith("en") ? "en" : "ja";
}

/** localStorage に保存された言語選択を読む (無効・未保存なら null) */
export function loadLocale(): Locale | null {
  try {
    const v = localStorage.getItem(LOCALE_STORAGE_KEY);
    return v !== null && isLocale(v) ? v : null;
  } catch {
    return null;
  }
}

/** 言語選択を localStorage に保存する (ストレージ無効環境では無視) */
export function saveLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // ストレージ無効環境では無視する
  }
}

/** 保存値を優先し、無ければブラウザ設定から初期ロケールを決める (スタンドアロン用) */
export function resolveLocale(): Locale {
  return loadLocale() ?? detectLocale();
}
