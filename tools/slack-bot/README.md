# Slack Bot - Scraps 投稿ボット

## 概要

指定した Slack チャンネルに投稿されたメッセージを監視し、自動的に scrap（Markdown ファイル）として `src/content/scraps/` に保存するボットです。

主な機能:

- メッセージの投稿を検知して scrap ファイルを自動生成（frontmatter 付き）
- メッセージの編集を検知して既存の scrap ファイルを更新（frontmatter は保持）
- 添付画像を `public/images/scraps/` にダウンロードし、Markdown の画像参照を挿入
- Slack mrkdwn 記法を標準 Markdown に自動変換（太字、斜体、取り消し線、リンクなど）

## 前提条件

- [Bun](https://bun.sh/) がインストールされていること
- Slack ワークスペースの管理者権限（Slack App を作成・インストールするため）

## Slack App のセットアップ

### 1. App の作成

1. [Slack API: Your Apps](https://api.slack.com/apps) にアクセス
2. **Create New App** > **From scratch** を選択
3. App 名とワークスペースを指定して作成

### 2. Socket Mode の有効化

1. サイドバーの **Settings** > **Socket Mode** を開く
2. **Enable Socket Mode** をオンにする
3. App-Level Token の生成を求められるので、トークン名を入力（例: `socket-token`）
4. スコープに **`connections:write`** を追加
5. **Generate** をクリック
6. 生成された `xapp-` で始まるトークンを控えておく（後で `SLACK_APP_TOKEN` として使用）

### 3. Event Subscriptions の有効化

1. サイドバーの **Features** > **Event Subscriptions** を開く
2. **Enable Events** をオンにする
3. **Subscribe to bot events** セクションで **Add Bot User Event** をクリック
4. **`message.channels`**（パブリックチャンネル）を追加
   - プライベートチャンネルを使う場合は **`message.groups`** も追加
5. **Save Changes** をクリック

### 4. OAuth & Permissions の設定

1. サイドバーの **Features** > **OAuth & Permissions** を開く
2. **Scopes** セクションの **Bot Token Scopes** に以下を追加:
   - **`channels:history`** — パブリックチャンネルのメッセージを読み取る
   - **`groups:history`** — プライベートチャンネルのメッセージを読み取る（プライベートチャンネルを使う場合）
   - **`files:read`** — 添付ファイル（画像）をダウンロードする
   - **`reactions:write`** — メッセージにリアクション（処理中 🏃 / 完了 ✅）を付与・削除する

### 5. ワークスペースへのインストール

1. サイドバーの **Settings** > **Install App** を開く
2. **Install to Workspace** をクリックし、権限を許可
3. 表示される **Bot User OAuth Token**（`xoxb-` で始まる）を控えておく（後で `SLACK_BOT_TOKEN` として使用）

## 環境変数の設定

プロジェクトの `tools/slack-bot/` ディレクトリに `.env` ファイルを作成し、以下の環境変数を設定します。

```bash
SLACK_BOT_TOKEN=xoxb-xxxx-xxxx-xxxx   # Bot User OAuth Token
SLACK_APP_TOKEN=xapp-x-xxxx-xxxx      # App-Level Token (Socket Mode 用)
SLACK_CHANNEL_ID=C0XXXXXXXXX          # 監視対象チャンネルの ID
DEFAULT_TAGS=slack                     # scrap に付与するデフォルトタグ (カンマ区切りで複数指定可)
```

### SLACK_CHANNEL_ID の取得方法

1. Slack デスクトップアプリまたは Web 版で対象チャンネルを開く
2. チャンネル名をクリックしてチャンネル詳細を表示
3. 詳細パネルの最下部に表示されるチャンネル ID（`C` で始まる文字列）をコピー

または、チャンネルのリンクをコピーすると URL 末尾に含まれるチャンネル ID を確認できます（例: `https://xxx.slack.com/archives/C0XXXXXXXXX`）。

## インストールと起動

```bash
cd tools/slack-bot

# 依存パッケージのインストール
bun install

# 起動
bun start

# 開発時 (ファイル変更時に自動再起動)
bun dev
```

## ボットをチャンネルに招待する

ボットが起動しても、監視対象チャンネルに参加していなければイベントを受信できません。Slack で対象チャンネルを開き、以下のコマンドを実行してボットを招待してください。

```
/invite @<ボットのApp名>
```

## 動作確認

1. ボットを起動する（`bun start`）
2. 監視対象チャンネルにテキストメッセージを投稿する
3. ターミナルに `scrap 作成: ...` のログが出力されることを確認
4. `src/content/scraps/` 以下に `YYYY-MM-DD-<slug>.md` ファイルが生成されていることを確認
5. メッセージを編集すると、対応する scrap ファイルの本文が更新されることを確認

画像付きメッセージを投稿した場合は、`public/images/scraps/` に画像が保存され、Markdown ファイル内に画像参照が含まれます。

## トラブルシューティング

イベントが届かない場合、以下を順番に確認してください。

- [ ] **環境変数は正しく設定されているか** — `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_CHANNEL_ID` がすべて設定されていること
- [ ] **Socket Mode が有効か** — Slack App 設定の **Socket Mode** がオンになっていること
- [ ] **Event Subscriptions が有効か** — **Enable Events** がオンで、**`message.channels`**（パブリック）または **`message.groups`**（プライベート）が bot event に追加されていること
- [ ] **Bot Token Scopes は十分か** — `channels:history`, `files:read`, `reactions:write` が付与されていること
- [ ] **ボットがチャンネルに参加しているか** — `/invite @<ボット名>` でチャンネルに招待済みであること
- [ ] **SLACK_CHANNEL_ID は正しいか** — チャンネル詳細から取得した ID と一致していること
- [ ] **ボットが起動しているか** — ターミナルに `Slack bot 起動` のログが出力されていること
- [ ] **App を再インストールしたか** — スコープやイベントを変更した場合、**Install App** から再インストールが必要
