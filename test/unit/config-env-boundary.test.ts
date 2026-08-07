// cases: docs/engineering/testing/unit/experiments-runner.md
// 「调度项优先级」类别里的白名单守护:配置项只从 CLI flag / experiment / config 来,
// 环境变量只承担凭据与终端环境事实(契约见 docs/architecture.md「配置从代码来,凭据从环境来」)。
// 扫 src/ 下非测试源码实际读到的环境变量名,断言它们都在白名单里——新加一个配置类环境变量
// 就会红,不需要这份测试预先知道它叫什么。

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = new URL("../../src/", import.meta.url).pathname;

/**
 * 允许被读取的环境变量。每一条都能在边界表里指到自己那一行:
 * 凭据(变量名由对应 adapter / sandbox / judge 声明)与终端环境事实。
 * 往这里加名字前先问:这个值是不是配置?是的话它的家在 config,不在这张表。
 */
const ALLOWED = new Set([
  // 凭据:agent
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "CODEX_API_KEY",
  "CODEX_BASE_URL",
  "BUB_API_KEY",
  "BUB_API_BASE",
  "OPENCODE_API_KEY",
  "OPENCODE_BASE_URL",
  "HERMES_API_KEY",
  "HERMES_API_BASE",
  "OPENROUTER_API_KEY",
  "OPENCLAW_API_KEY",
  "OPENCLAW_BASE_URL",
  // 凭据:judge(judge.apiKeyEnv 指定别的名字时是运行期动态读取,不出现在静态扫描里)
  "NICEEVAL_JUDGE_KEY",
  // 凭据:sandbox provider
  "E2B_API_KEY",
  "VERCEL_API_TOKEN",
  "VERCEL_TEAM_ID",
  "VERCEL_PROJECT_ID",
  // Host integration test / portable packaging override; production registry remains /etc/niceeval/docker-profiles.
  "NICEEVAL_DOCKER_PROFILE_REGISTRY",
  // 终端环境事实
  "NO_COLOR",
  "LC_ALL",
  "LC_MESSAGES",
  "LANG",
  "COLUMNS",
  // 进程自身的环境(整袋透传给子进程 / 沙箱,不是读某个具体配置)
  "HOME",
  "PATH",
]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry) || entry.includes(".test.")) continue;
    out.push(full);
  }
  return out;
}

/**
 * `process.env.X` / `process.env["X"]` / `getEnv("X")` / `requireEnv("X")`，加上收 env 形参的
 * 函数里的 `env.X`（`detectLocale` 就是这种）。最后一条排除赋值写法：往子进程 / 沙箱的 env
 * 里**写**一个变量（`env.BUB_MODEL = …`）是把配置传下去，不是从环境里读配置。
 */
const READS = [
  /process\.env\.([A-Z][A-Z0-9_]*)/g,
  /process\.env\[\s*"([A-Z][A-Z0-9_]*)"\s*\]/g,
  /\b(?:getEnv|requireEnv)\(\s*"([A-Z][A-Z0-9_]*)"\s*\)/g,
  /\benv\.([A-Z][A-Z0-9_]{2,})\b(?!\s*=[^=])/g,
];

describe("配置与凭据的边界", () => {
  it("src/ 只读取白名单里的环境变量", () => {
    const found = new Map<string, string>();
    for (const file of sourceFiles(SRC)) {
      const code = readFileSync(file, "utf-8");
      for (const pattern of READS) {
        for (const match of code.matchAll(pattern)) {
          const name = match[1]!;
          if (!found.has(name)) found.set(name, file.slice(SRC.length));
        }
      }
    }
    const offenders = [...found.entries()]
      .filter(([name]) => !ALLOWED.has(name))
      .map(([name, file]) => `${name} (${file})`)
      .sort();
    expect(
      offenders,
      "这些环境变量不在「凭据 + 终端环境」白名单里。配置项的家是 CLI flag / experiment / niceeval.config.ts,见 docs/architecture.md「配置从代码来,凭据从环境来」",
    ).toEqual([]);
  });
});
