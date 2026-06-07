// 三位一体モデル (意味 / 視覚 / ソース) を統合した編集用の型定義

/** テキスト上の半開区間 [start, end) を文字オフセットで表す */
export interface SourceRange {
  start: number; // 開始オフセット (0 始まり)
  end: number; // 終了オフセット (この位置の文字は含まない)
}

/** 1 回のテキスト書き換え単位 */
export interface TextEdit {
  range: SourceRange;
  newText: string;
}

/**
 * 編集可能な 1 フィールド。
 * value が現れる全テキスト範囲を ranges に持ち、編集時は全範囲を新値へ置換する。
 * ラベルは単一範囲、ノード ID リネームは宣言 + 全参照の複数範囲になる。
 */
export interface EditableField {
  name: string; // 例: "label" / "id"
  value: string; // 現在値
  ranges: SourceRange[]; // この値が現れる全範囲 (surgical edit の対象)
}

/** ソースモデル: トークナイザが算出したノード宣言の位置情報 */
export interface NodeToken {
  id: string; // 論理ノード ID (例: "A")
  label: string; // ラベル文字列 (引用符の内側は除く)
  labelRange: SourceRange; // ラベル文字列のテキスト範囲
  idRanges: SourceRange[]; // ID が現れる全範囲 (宣言 + 参照)。リネーム用
  removeLines: SourceRange[]; // ID が現れる全行の範囲 (重複なし)。カスケード削除用
  shapeOpen: SourceRange; // 形状の開き括弧の範囲。形状変更用
  shapeClose: SourceRange; // 形状の閉じ括弧の範囲。形状変更用
}

/** ソースモデル: エッジラベル (|text| 形式) の位置情報 */
export interface EdgeLabelToken {
  label: string; // ラベル文字列 (引用符の内側は除く)
  labelRange: SourceRange; // ラベル文字列のテキスト範囲
}

/** ソースモデル: エッジ (A --> B) の位置情報 */
export interface EdgeToken {
  fromId: string;
  fromRange: SourceRange; // この辺における始点 ID の範囲 (再接続用)
  toId: string;
  toRange: SourceRange; // この辺における終点 ID の範囲 (再接続用)
  index: number; // 同一 from→to の通し番号 (SVG パス L_from_to_index との対応)
  linkRange: SourceRange; // リンク演算子 (-->, -.->, ==> 等) の範囲 (線種変更用)
  statementRange: SourceRange; // 辺を含む行の範囲 (削除用)
  label?: { value: string; range: SourceRange }; // 付与されていれば
}

/** 視覚モデル: SVG のエッジパスと、そこから復元した from/to/index */
export interface EdgeVisual {
  fromId: string;
  toId: string;
  index: number;
  el: SVGGraphicsElement; // 対応する path.flowchart-link
}

/** 視覚モデル: レンダリング後の SVG から得たノードの幾何情報 */
export interface NodeVisual {
  id: string; // 論理ノード ID (SVG から逆引き)
  el: SVGGElement; // 対応する SVG の g 要素
}

/** 視覚モデル: SVG のエッジラベル g 要素とその表示テキスト */
export interface EdgeLabelVisual {
  text: string; // 表示テキスト
  el: SVGGElement; // 対応する g.edgeLabel
}

// ---- シーケンス図 ----

/** ソースモデル: アクター宣言 (participant/actor ... as <display>) */
export interface ActorToken {
  id: string; // アクター ID
  display: string; // 表示名 (as の後)
  displayRange: SourceRange; // 表示名のテキスト範囲
  removeLines: SourceRange[]; // 宣言行 + 参照メッセージ行 (カスケード削除用)
}

/** ソースモデル: メッセージ (A->>B: text) */
export interface MessageToken {
  text: string; // メッセージ本文
  textRange: SourceRange; // 本文のテキスト範囲
  arrowRange: SourceRange; // 矢印演算子 (->>, -->>, ->, -x 等) の範囲 (種別変更用)
  activationRange: SourceRange; // 矢印と相手の間の [+-]? の範囲 (起動/終了の切替用、空幅あり)
  removeLines: SourceRange[]; // メッセージ行 (削除用)
}

/** ソースモデル: ノート (Note over/right of/left of ... : text) */
export interface NoteToken {
  text: string; // ノート本文
  textRange: SourceRange; // 本文のテキスト範囲
  removeLines: SourceRange[]; // ノート行 (削除用)
}

/** ソースモデル: 制御ブロックのヘッダ (loop/alt/opt/par <label>) */
export interface BlockToken {
  label: string; // ブロックのラベル
  labelRange: SourceRange; // ラベルのテキスト範囲
}

/** 視覚モデル: SVG のテキスト要素とその表示テキスト (アクター / メッセージ) */
export interface TextVisual {
  text: string; // 表示テキスト
  el: SVGGraphicsElement; // 対応する text 要素
  lineEl?: SVGGraphicsElement; // メッセージの矢印線 (line.messageLine*)。クリック領域用
}

/** 3 モデルを突き合わせた編集可能要素 */
export interface EditableElement {
  id: string;
  kind: "node" | "edge" | "edgeLabel" | "actor" | "message" | "note" | "block" | "lifeline";
  el: SVGGraphicsElement; // 視覚モデル由来 (g / text いずれも可)
  fields: EditableField[]; // ソースモデル由来 (空なら編集不可)
  refId?: string; // ソース上の論理参照 ID (ノード ID / アクター ID)。接続/追加用
  removeLines?: SourceRange[]; // 削除時に消す行範囲 (未定義なら削除不可)
  shapeRanges?: { open: SourceRange; close: SourceRange }; // 形状変更用 (ノードのみ)
  operatorRange?: SourceRange; // 演算子の範囲。線種/種別変更用 (エッジ・メッセージ)
  activationRange?: SourceRange; // [+-]? の範囲。起動/終了の切替用 (メッセージのみ)
  lineEl?: SVGGraphicsElement; // メッセージの矢印線。線上のクリック領域用 (メッセージのみ)
}
