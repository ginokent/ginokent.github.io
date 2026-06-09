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
    autonumber

    participant U as User / Resource Owner<br/>ユーザー
    participant C as Client App<br/>アプリ
    participant AS as Authorization Server<br/>認可サーバー
    participant RS as Resource Server<br/>API サーバー

    U->>C: 連携開始
    C->>C: code_verifier を生成
    C->>C: code_challenge を生成

    C->>AS: 認可リクエスト<br/>client_id, redirect_uri, scope, state, code_challenge
    AS->>U: ログイン画面・同意画面を表示
    U->>AS: ログイン・同意

    AS-->>C: redirect_uri にリダイレクト<br/>authorization code, state

    C->>C: state を検証

    C->>AS: token request<br/>code, redirect_uri, client_id, code_verifier
    AS->>AS: code_verifier を検証
    AS-->>C: access_token / refresh_token

    C->>RS: API request<br/>Authorization: Bearer access_token
    RS->>RS: access_token を検証
    RS-->>C: protected resource`,
  },
];
