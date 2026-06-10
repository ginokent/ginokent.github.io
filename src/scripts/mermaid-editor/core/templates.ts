// 図種ごとのテンプレート。ツールバーのボタンから全文置換に使う。
// 編集オーバーレイに対応する図種 (flowchart / sequence) のみを用意する。
// 先頭 (TEMPLATES[0]) が初回起動時の既定図 (main.ts の load() フォールバック)。

export interface Template {
  key: string; // 図種キー
  label: string; // ボタン表示名
  text: string; // テンプレート本文
}

export const TEMPLATES: Template[] = [
  {
    key: "sequence",
    label: "シーケンス図",
    text: `---
title: Authorization Code Flow with PKCE
---
sequenceDiagram
    autonumber

    participant U as User<br/>Resource Owner
    participant B as Browser / User-Agent
    participant C as Client<br/>SPA / Mobile App / Web App
    participant AS as Authorization Server
    participant RS as Resource Server<br/>API

    U->>C: ログイン / 連携開始

    C->>C: code_verifier を生成
    C->>C: code_challenge = BASE64URL(SHA256(code_verifier)) を生成

    C->>B: 認可エンドポイントへリダイレクト
    B->>AS: GET /authorize<br/>response_type=code<br/>client_id<br/>redirect_uri<br/>scope<br/>state<br/>code_challenge<br/>code_challenge_method=S256

    AS->>U: ログイン画面を表示
    U->>AS: 認証情報を入力

    AS->>U: 同意画面を表示
    U->>AS: scope へのアクセスを許可

    AS->>B: redirect_uri にリダイレクト<br/>?code=authorization_code&state=...
    B->>C: authorization_code と state を渡す

    C->>C: state を検証

    C->>AS: POST /token<br/>grant_type=authorization_code<br/>code<br/>redirect_uri<br/>client_id<br/>code_verifier

    AS->>AS: code_verifier から code_challenge を再計算
    AS->>AS: /authorize 時の code_challenge と照合

    AS-->>C: access_token<br/>refresh_token 任意<br/>id_token 任意

    C->>RS: API request<br/>Authorization: Bearer access_token

    RS->>RS: access_token を検証
    RS-->>C: Protected Resource`,
  },
  {
    key: "flowchart",
    label: "フローチャート",
    text: `---
title: Least Recently Used
---
flowchart TD
    Start([開始]) --> Req[キーへのアクセス要求<br/>get または put]
    Req --> Exists{キーはキャッシュに存在する？}

    Exists -->|Yes| Hit[Cache Hit]
    Hit --> UpdateValue{put 操作？}
    UpdateValue -->|Yes| SetValue[値を更新]
    UpdateValue -->|No| MoveRecent[対象キーを<br/>Most Recently Used に移動]
    SetValue --> MoveRecent
    MoveRecent --> Return[結果を返す]
    Return --> End([終了])

    Exists -->|No| Miss[Cache Miss]
    Miss --> IsGet{get 操作？}
    IsGet -->|Yes| NotFound[Not Found を返す]
    NotFound --> End

    IsGet -->|No: put| HasSpace{キャッシュ容量に空きがある？}
    HasSpace -->|Yes| Insert[新しいキーと値を追加]
    HasSpace -->|No| Evict[Least Recently Used を削除]
    Evict --> Insert
    Insert --> MarkRecent[追加したキーを<br/>Most Recently Used にする]
    MarkRecent --> Return`,
  },
];
