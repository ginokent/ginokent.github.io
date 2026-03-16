import { basename } from "node:path";
import { config } from "../config.js";

/** scrap ファイル（と画像）を git add, commit, push する。GIT_AUTO_COMMIT_PUSH=true の場合のみ実行する。 */
export async function gitCommitPush(...filePaths: string[]): Promise<void> {
  if (!config.gitAutoCommitPush) return;
  if (filePaths.length === 0) return;

  const filename = basename(filePaths[0]);
  const message = `docs(scraps): add ${filename}`;

  try {
    await run("git", ["add", ...filePaths]);

    // staged diff がなければ commit/push をスキップ
    if (await isClean()) {
      console.log(`ℹ️ 差分なし、commit スキップ: ${filename}`);
      return;
    }

    await run("git", ["commit", "--only", ...filePaths, "-m", message]);
    await run("git", ["push"]);
    console.log(`📤 git push 完了: ${filename}`);
  } catch (e) {
    console.error(`⚠️ git 操作失敗:`, e);
  }
}

/** staged diff がないとき true を返す */
async function isClean(): Promise<boolean> {
  const proc = Bun.spawn(["git", "diff", "--cached", "--quiet"], {
    cwd: config.projectRoot,
    stdout: "ignore",
    stderr: "ignore",
  });
  const exitCode = await proc.exited;
  return exitCode === 0; // 0 = 差分なし
}

async function run(cmd: string, args: string[]): Promise<void> {
  const proc = Bun.spawn([cmd, ...args], {
    cwd: config.projectRoot,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed with exit code ${exitCode}`);
  }
}
