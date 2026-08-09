import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * 每个 owner 自己在这个副本内写入 `.niceeval`；这里仅声明副本生命周期和
 * 已安装 candidate 的 node_modules 链接，不封装任何产品 argv 或 expected。
 */
export const reportProjectCopy = {
  from: process.cwd(),
  prefix: "niceeval-e2e-report-",
  omitTopLevel: [".niceeval", "evidence", "node_modules", "site-export", "test", "test-results"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

/**
 * withProjectCopy 会清理运行副本；在它清理前把本轮 `.niceeval` 复制到场景的
 * artifact staging 目录。它只用于失败诊断，绝不作为下一 case 的输入。
 */
export async function retainEvidence(
  root: string,
  caseName: string,
  extraDirectories: readonly string[] = [],
): Promise<void> {
  const destination = join(process.cwd(), "evidence", caseName);
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });

  const recordRoot = join(root, ".niceeval");
  if (existsSync(recordRoot)) {
    await cp(recordRoot, join(destination, ".niceeval"), { recursive: true });
  }

  for (const directory of extraDirectories) {
    const source = join(root, directory);
    if (existsSync(source)) {
      await cp(source, join(destination, directory), { recursive: true });
    }
  }
}
