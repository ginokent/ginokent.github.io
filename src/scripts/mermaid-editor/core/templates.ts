// 図種ごとのテンプレート。ツールバーのボタンから全文置換に使う。
// 編集オーバーレイに対応する図種 (flowchart / sequence) のみを用意する。

export interface Template {
  key: string; // 図種キー
  label: string; // ボタン表示名
  text: string; // テンプレート本文
}

export const TEMPLATES: Template[] = [
  {
    key: "flowchart",
    label: "フローチャート",
    text: `flowchart TD
  A[開始] --> B{条件判定}
  B -->|はい| C([完了])
  B -->|いいえ| D[やり直す]
  D --> A`,
  },
  {
    key: "sequence",
    label: "シーケンス図",
    text: `sequenceDiagram
  participant U as ユーザー
  participant S as サーバー
  U->>+S: リクエスト
  S-->>-U: レスポンス
  Note over U,S: やり取りの例`,
  },
];
