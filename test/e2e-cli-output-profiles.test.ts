// e2e 回归:CLI `--output` profile 机制自身的验收(见 plan/exp-output-feedback-models.md
// 「CLI spawn 验收」测试矩阵)。这份矩阵此前只有一次性人工验证记录(review 里逐条重跑
// `node bin/niceeval.js ...` 手工确认),没有持久化成回归测试——这里把能在非 TTY 子进程里
// 确定性复现的部分转成真正的 spawn 级测试:
//   - `--output agent` / `--output ci` 全程无 ANSI(byte-level ESC 扫描,不是字符串包含检查)。
//   - `ci` 的 stderr 完全为空(正常事件全部走 stdout 单一有序流,不分流)。
//   - 显式 `--output human` 在非 TTY(spawn 管道天然如此,不需要伪造)下退化为纯追加文案,
//     不写 ANSI,也不偷偷切换成 agent/ci 的行文本(profile 是消费者模型,不因传输能力改变)。
//   - `--output auto`:清空 CI 环境标记的管道 → agent;`CI=true` → ci。
//   - `--dry` 在三种 profile 下都不创建 `.niceeval` 快照目录,也不写 `--json`/`--junit`。
//   - `--quiet` 报未知 flag 错误、非零退出(`--quiet` 已从 CLI 删除,不是第四种反馈模式)。
//
// 矩阵里唯一没有自动化覆盖的一行是「`--output human` 在真实/伪 TTY 中动态覆盖」——判断
// isTTY 依赖真实终端设备,子进程管道(`stdio: "pipe"`)天然是非 TTY,Node 没有内置 API 能在
// 不引入原生 pty 依赖(如 node-pty)的前提下伪造 `isTTY: true`;这一行继续依赖人工验证。
//
// 全程不联网、不起沙箱:fixture 用一个 remote kind 的 mock agent,秒回固定文本、恒定通过。

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterAll, beforeEach, expect, test } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const fixtureDir = join(here, "fixtures", "cli-output-profiles");
const cliEntry = join(repoRoot, "bin", "niceeval.js");

// resolveOutputProfile()(src/runner/feedback/profile.ts 的 CI_ENV_VARS)识别的 CI 平台标记。
// 测试进程自己也可能正在某个 CI 平台里跑,必须显式清空,否则"没有 CI 标记的管道"这个场景
// 在真实 CI 里会失真(auto 会被误判成 ci,不是这里想测的 agent 分支)。与源码保持同一份列表,
// 新增平台需要两边同步更新。
const CI_ENV_VARS = [
  "CI",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "CIRCLECI",
  "TRAVIS",
  "BUILDKITE",
  "JENKINS_URL",
  "TEAMCITY_VERSION",
  "APPVEYOR",
  "TF_BUILD",
];

function cleanEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of CI_ENV_VARS) delete env[key];
  // 固定英文:字段名/行文案不本地化的部分(agent/ci)本就与语言无关,但 human 的文案会走
  // i18n——固定 NICEEVAL_LANG 让这里的字符串断言不随开发机 locale 漂移。
  return { ...env, NICEEVAL_LANG: "en", ...overrides };
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntry, ...args], { cwd: fixtureDir, env, stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

const ESC = "\x1b";
/** byte-level 扫描,不是"看起来像不像颜色码"的字符串启发式——只要出现 ESC(0x1b)就判定为
 *  含 ANSI/光标控制,agent/ci/非 TTY human 三者都不允许出现。 */
function hasAnsi(text: string): boolean {
  return text.includes(ESC);
}

async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

const niceevalDir = join(fixtureDir, ".niceeval");

beforeEach(async () => {
  await rm(niceevalDir, { recursive: true, force: true });
});

afterAll(async () => {
  await rm(niceevalDir, { recursive: true, force: true });
});

test("--output agent:全程无 ANSI,stdout 收到有界 handoff block", async () => {
  const { code, stdout, stderr } = await runCli(["exp", "--force", "--output", "agent"], cleanEnv());
  expect(code).toBe(0);
  expect(hasAnsi(stdout)).toBe(false);
  expect(hasAnsi(stderr)).toBe(false);
  expect(stdout).toContain("NICEEVAL RESULT");
});

test("--output ci:全程无 ANSI,普通 failure/正常事件不落 stderr(stderr 完全为空)", async () => {
  const { code, stdout, stderr } = await runCli(["exp", "--force", "--output", "ci"], cleanEnv());
  expect(code).toBe(0);
  expect(hasAnsi(stdout)).toBe(false);
  expect(stderr).toBe("");
  expect(stdout).toContain("niceeval: result=");
});

test("--output human 在非 TTY(spawn 管道)下退化为纯追加文案:无 ANSI,不偷偷变成 agent/ci 语义", async () => {
  const { code, stdout, stderr } = await runCli(["exp", "--force", "--output", "human"], cleanEnv());
  expect(code).toBe(0);
  expect(hasAnsi(stdout)).toBe(false);
  expect(hasAnsi(stderr)).toBe(false);
  // 真正的 human 文案(大写 PASSED,来自 feedback.human.resultPassed),不是被 TTY 检测
  // 失败就静默切换成另一个 profile 的输出形状。
  expect(stdout).toContain("PASSED");
  expect(stdout).not.toContain("NICEEVAL RESULT");
  expect(stdout).not.toContain("niceeval: result=");
});

test("--output auto:非 TTY 管道 + 无 CI 环境标记 → 解析成 agent", async () => {
  const { code, stdout } = await runCli(["exp", "--force"], cleanEnv());
  expect(code).toBe(0);
  expect(stdout).toContain("NICEEVAL RESULT");
});

test("--output auto:非 TTY 管道 + CI=true → 解析成 ci", async () => {
  const { code, stdout } = await runCli(["exp", "--force"], cleanEnv({ CI: "true" }));
  expect(code).toBe(0);
  expect(stdout).toContain("niceeval: result=");
});

test("exp 拒绝 show/view 专用 flag(--history):非零退出 + 明确用法错误,不静默忽略也不真的跑", async () => {
  const { code, stdout, stderr } = await runCli(["exp", "--history"], cleanEnv());
  expect(code).toBe(1);
  expect(stderr).toContain("`--history` only applies to niceeval show");
  // 没有静默吞掉后当成一次正常运行:不产生任何 profile 的结果收尾行。
  expect(stdout).not.toContain("NICEEVAL RESULT");
  expect(stdout).not.toContain("niceeval: result=");
});

test("exp 拒绝 view 专用 flag(--port):非零退出 + 明确用法错误", async () => {
  const { code, stderr } = await runCli(["exp", "--port", "3000"], cleanEnv());
  expect(code).toBe(1);
  expect(stderr).toContain("`--port` only applies to niceeval view");
});

for (const profile of ["human", "agent", "ci"] as const) {
  test(`--dry --output ${profile}:不创建 .niceeval 快照目录,也不写 --json/--junit`, async () => {
    const tmp = await mkdtemp(join(tmpdir(), "niceeval-dry-"));
    try {
      const jsonPath = join(tmp, "out.json");
      const junitPath = join(tmp, "out.xml");
      const { code, stdout } = await runCli(
        ["exp", "--dry", "--output", profile, "--json", jsonPath, "--junit", junitPath],
        cleanEnv(),
      );
      expect(code).toBe(0);
      expect(hasAnsi(stdout)).toBe(false);
      expect(await pathExists(niceevalDir)).toBe(false);
      expect(await pathExists(jsonPath)).toBe(false);
      expect(await pathExists(junitPath)).toBe(false);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
}

test("--quiet 报未知 flag 错误并非零退出(不是第四种反馈模式,已从 CLI 删除)", async () => {
  const { code, stderr } = await runCli(["exp", "--quiet"], cleanEnv());
  expect(code).not.toBe(0);
  expect(stderr.toLowerCase()).toContain("quiet");
});
