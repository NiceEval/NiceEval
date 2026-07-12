// e2e 回归:image-understanding 这条 eval 配一个「永远拒绝识图」的 mock agent 跑一遍真实 CLI
// (`niceeval exp`),断言最终 verdict 必须是 "failed"。
//
// 复现的真实 bug(见 examples/zh/ai-sdk 跑 deepseek-v4-pro 的记录):模型完全没看图、
// 明确说"不支持图像输入",但 `t.messageIncludes(/蓝|blue|白|方块|图片|颜色/i)` 这条 gate
// 断言里塞了太泛的词("图片"/"颜色"),连拒绝语本身都能命中而误判通过;真正能识别出
// "答非所问"的 judge 断言只是 soft + `.atLeast(0.7)`,非 --strict 不会让 verdict 变 failed
// (这是 docs/feature/scoring/README.md 文档化的既定设计,不是要改的地方)。两者叠加,eval 悄悄"passed"。
//
// 全程不联网:mock agent 进程内跑,judge 打到本机起的一个假 OpenAI 兼容 server。

import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile, readdir, rm } from "node:fs/promises";
import { afterAll, beforeAll, expect, test } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const fixtureDir = join(here, "fixtures", "image-refusal");

let judgeServer: Server;
let judgePort: number;

beforeAll(async () => {
  await rm(join(fixtureDir, ".niceeval"), { recursive: true, force: true });
  judgeServer = await new Promise<Server>((resolve) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        const payload = {
          choices: [{ message: { role: "assistant", content: JSON.stringify({ reasoning: "拒绝识图,答非所问。", score: 0 }) } }],
        };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
  judgePort = (judgeServer.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise((resolve) => judgeServer.close(resolve));
  await rm(join(fixtureDir, ".niceeval"), { recursive: true, force: true });
});

async function runFixtureCli(): Promise<void> {
  const child = spawn(process.execPath, [join(repoRoot, "bin", "niceeval.js"), "exp", "--force", "--quiet"], {
    cwd: fixtureDir,
    env: {
      ...process.env,
      NICEEVAL_JUDGE_BASE: `http://127.0.0.1:${judgePort}/v1`,
      NICEEVAL_JUDGE_KEY: "mock-key",
    },
    stdio: "pipe",
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += String(d)));
  const code = await new Promise<number>((resolve) => child.on("exit", (c) => resolve(c ?? 1)));
  // 这条夹具就是设计成"该 fail"的:退出码非 0 是预期的,这里只兜底真正的崩溃(比如 eval 发现失败)。
  if (code !== 0 && code !== 1) {
    throw new Error(`niceeval exp exited ${code}\n${stderr}`);
  }
}

// 新落盘布局(Results Format schemaVersion 4,见 docs/feature/results/architecture.md)是
// .niceeval/<experiment>/<timestamp-rand>/snapshot.json + <evalId>/a<n>/result.json,
// 不再有 run 级 summary.json。这里递归找出全部快照,取 startedAt 最新的那个,
// 再收集它下面全部 result.json 拼出与旧 summary.results 等价的输入(逐条补回
// experimentId——它是快照级字段,不落在 attempt 记录里)。
async function findFiles(dir: string, filename: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await findFiles(full, filename)));
    else if (entry.name === filename) found.push(full);
  }
  return found;
}

async function readLatestSummary(): Promise<{ results: Array<{ id: string; verdict: string }> }> {
  const runDirRoot = join(fixtureDir, ".niceeval");
  const snapshotMetaPaths = await findFiles(runDirRoot, "snapshot.json");
  if (snapshotMetaPaths.length === 0) throw new Error(`no snapshot found under ${runDirRoot}`);
  const snapshots = await Promise.all(
    snapshotMetaPaths.map(async (metaPath) => {
      const meta = JSON.parse(await readFile(metaPath, "utf-8")) as { experimentId: string; startedAt: string };
      return { dir: dirname(metaPath), ...meta };
    }),
  );
  const latest = snapshots.reduce((a, b) => (b.startedAt > a.startedAt ? b : a));
  const resultPaths = await findFiles(latest.dir, "result.json");
  const results = await Promise.all(
    resultPaths.map(async (p) => {
      const record = JSON.parse(await readFile(p, "utf-8")) as { id: string; verdict: string };
      return { ...record, experimentId: latest.experimentId };
    }),
  );
  return { results };
}

test("image-understanding: 模型明确拒绝识图时,eval 必须 failed,不能悄悄 passed", async () => {
  await runFixtureCli();
  const summary = await readLatestSummary();
  const result = summary.results.find((r) => r.id === "image-understanding");
  expect(result?.verdict).toBe("failed");
});
