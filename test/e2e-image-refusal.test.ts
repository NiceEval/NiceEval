// e2e 回归:image-understanding 这条 eval 配一个「永远拒绝识图」的 mock agent 跑一遍真实 CLI
// (`niceeval exp`),断言最终 verdict 必须是 "failed"。
//
// 复现的真实 bug(见 examples/zh/ai-sdk 跑 deepseek-v4-pro 的记录):模型完全没看图、
// 明确说"不支持图像输入",但 `t.messageIncludes(/蓝|blue|白|方块|图片|颜色/i)` 这条 gate
// 断言里塞了太泛的词("图片"/"颜色"),连拒绝语本身都能命中而误判通过;真正能识别出
// "答非所问"的 judge 断言只是 soft + `.atLeast(0.7)`,非 --strict 不会让 verdict 变 failed
// (这是 docs/scoring.md 文档化的既定设计,不是要改的地方)。两者叠加,eval 悄悄"passed"。
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

async function readLatestSummary(): Promise<{ results: Array<{ id: string; verdict: string }> }> {
  const runDirRoot = join(fixtureDir, ".niceeval");
  const runs = (await readdir(runDirRoot)).sort();
  const latest = runs.at(-1);
  if (!latest) throw new Error(`no .niceeval run under ${runDirRoot}`);
  const raw = await readFile(join(runDirRoot, latest, "summary.json"), "utf-8");
  return JSON.parse(raw);
}

test("image-understanding: 模型明确拒绝识图时,eval 必须 failed,不能悄悄 passed", async () => {
  await runFixtureCli();
  const summary = await readLatestSummary();
  const result = summary.results.find((r) => r.id === "image-understanding");
  expect(result?.verdict).toBe("failed");
});
