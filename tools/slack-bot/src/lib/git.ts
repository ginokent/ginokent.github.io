import { basename } from "node:path";
import { config } from "../config.js";

/** scrap ファイルを git add, commit, push する。GIT_AUTO_COMMIT_PUSH=true の場合のみ実行する。 */
export async function gitCommitPush(filePath: string): Promise<void> {
  if (!config.gitAutoCommitPush) return;

  const filename = basename(filePath);
  const message = `docs(scraps): add ${filename}`;

  try {
    await run("git", ["add", filePath]);
    await run("git", ["commit", "-m", message]);
    await run("git", ["push"]);
    console.log(`📤 git push 完了: ${filename}`);
  } catch (e) {
    console.error(`⚠️ git 操作失敗:`, e);
  }
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
