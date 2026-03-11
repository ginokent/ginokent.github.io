/**
 * Slack mrkdwn を標準 Markdown に変換する。
 * コードブロック内は変換しない。
 */
export function slackMrkdwnToMarkdown(text: string): string {
  // コードブロックを退避
  const codeBlocks: string[] = [];
  let result = text.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `\x00CODEBLOCK_${codeBlocks.length - 1}\x00`;
  });

  // インラインコードを退避
  const inlineCodes: string[] = [];
  result = result.replace(/`[^`]+`/g, (match) => {
    inlineCodes.push(match);
    return `\x00INLINECODE_${inlineCodes.length - 1}\x00`;
  });

  // Slack mrkdwn -> Markdown 変換
  // bold: *text* -> **text**
  result = result.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "**$1**");
  // italic: _text_ -> *text*
  result = result.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "*$1*");
  // strikethrough: ~text~ -> ~~text~~
  result = result.replace(/(?<!\w)~([^~\n]+)~(?!\w)/g, "~~$1~~");
  // link with label: <URL|label> -> [label](URL)
  result = result.replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "[$2]($1)");
  // bare link: <URL> -> URL
  result = result.replace(/<(https?:\/\/[^>]+)>/g, "$1");
  // user mention: <@U...> -> 除去
  result = result.replace(/<@U[A-Z0-9]+>/g, "");
  // channel mention: <#C...|name> -> #name
  result = result.replace(/<#C[A-Z0-9]+\|([^>]+)>/g, "#$1");

  // インラインコードを復元
  result = result.replace(/\x00INLINECODE_(\d+)\x00/g, (_, i) => inlineCodes[Number(i)]);
  // コードブロックを復元
  result = result.replace(/\x00CODEBLOCK_(\d+)\x00/g, (_, i) => codeBlocks[Number(i)]);

  return result.trim();
}
