import { resolve } from "node:path";

const MAP_PATH = resolve(import.meta.dir, "../../.message-map.json");

type MessageMap = Record<string, string>;

async function load(): Promise<MessageMap> {
  const file = Bun.file(MAP_PATH);
  if (!(await file.exists())) return {};
  return file.json();
}

async function save(map: MessageMap): Promise<void> {
  await Bun.write(MAP_PATH, JSON.stringify(map, null, 2) + "\n");
}

/** ts に対応する scrap ファイルパスを取得 */
export async function getFilePath(ts: string): Promise<string | undefined> {
  const map = await load();
  return map[ts];
}

/** ts と scrap ファイルパスのマッピングを保存 */
export async function setFilePath(ts: string, filePath: string): Promise<void> {
  const map = await load();
  map[ts] = filePath;
  await save(map);
}
