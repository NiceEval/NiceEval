// 唯一执行入口(docs/engineering/e2e-ci/README.md §3.1):清理上次运行的临时结果、跑
// verify.ts、把结果折叠成 0(契约符合预期)/ 75(EX_TEMPFAIL,能确证的外部故障)/ 其它非零
// (回归)。本仓库没有被测服务要起停(真实远程网关),第 4/7 步天然跳过。

import "dotenv/config";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { runVerify } from "./verify.ts";

const EX_TEMPFAIL = 75;
const LOG_DIR = "logs";
const CI_LOG = `${LOG_DIR}/exp-ci.log`;

class InfraError extends Error {}

function requireSecret(name: string): void {
  if (!process.env[name]) {
    console.error(`[e2e] 缺少必需的环境变量 ${name}——openai-compat 仓库需要真实网关凭据(见 .env.example)`);
    process.exit(1);
  }
}

/** §3.2:运行开头打印 niceeval 的解析路径与版本,供日志诊断(核验义务在根编排器,不在这里)。 */
function printResolvedNiceeval(): void {
  const version = spawnSync("pnpm exec niceeval --version", { shell: true, encoding: "utf8" });
  console.log(`[e2e] niceeval --version: ${(version.stdout ?? "").trim() || "(failed to resolve)"}`);
  const ls = spawnSync("pnpm ls niceeval --depth 0", { shell: true, encoding: "utf8" });
  console.log(`[e2e] pnpm ls niceeval:\n${(ls.stdout ?? "").trim()}`);
}

function cleanPreviousRun(): void {
  for (const p of [".niceeval", "junit-chat-completions.xml", "junit-responses.xml", "summary-chat-completions.json", LOG_DIR]) {
    rmSync(p, { recursive: true, force: true });
  }
  mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * 把 verify() 期间跑实验的输出捕获成 `logs/exp-ci.log`,供失败分类的日志正则扫描
 * (README §3.1 的 75 分类规则)。verify.ts 里的 `sh()` 直接调用 spawnSync 并不写日志文件,
 * 所以这里额外跑一次同样的 `--output ci` 命令、把 stdout+stderr 落盘,仅用于分类诊断——
 * 不影响 verify.ts 自身的断言判定。
 */
function captureCiLogForClassification(): void {
  // 裸 `exp`(不带位置参数)选中本仓库全部实验(chat-completions + responses);不带 --force
  // 复用 verify.ts 已经跑过的 attempt,不重复花钱,只为了拿一份 `--output ci` 格式的日志做分类。
  const res = spawnSync(
    `pnpm exec niceeval exp --output ci --json ${LOG_DIR}/classify-summary.json`,
    { shell: true, encoding: "utf8" },
  );
  writeFileSync(CI_LOG, `${res.stdout ?? ""}\n${res.stderr ?? ""}`);
}

/**
 * 能确证的外部故障才退 75。除了 README §3.1 默认的 429/5xx/连接错误,本仓库额外确证一种:
 * 网关返回 `API_KEY_DISABLED`——已用与本仓库无关的直连请求验证过,同一把 key 对该网关的
 * 全部端点(/chat/completions、/responses、/models)都返回这个结构化错误,说明是网关侧
 * 禁用了这把 key,不是请求构造错误(见本仓库 README「已知阻塞」一节)。判不准的情况一律不
 * 走这条分支,按回归退出。
 */
function isConfirmedInfraFailure(ciLog: string): boolean {
  if (/errored .*(429|5\d\d|ECONNREFUSED|ETIMEDOUT)/.test(ciLog)) return true;
  if (/API_KEY_DISABLED/.test(ciLog)) return true;
  return false;
}

async function main(): Promise<void> {
  requireSecret("OPENAI_API_KEY");
  requireSecret("OPENAI_BASE_URL");

  printResolvedNiceeval();
  cleanPreviousRun();

  try {
    runVerify();
    console.log("[e2e] all checks passed — exit 0");
    process.exit(0);
  } catch (err) {
    console.error(err);
    captureCiLogForClassification();
    let ciLog = "";
    try {
      ciLog = readFileSync(CI_LOG, "utf8");
    } catch {
      // 日志都拿不到时按回归退出,不猜测是基础设施问题。
    }
    const infra = err instanceof InfraError || isConfirmedInfraFailure(ciLog);
    console.error(`[e2e] classified as ${infra ? "infra (75)" : "regression"}`);
    process.exit(infra ? EX_TEMPFAIL : 1);
  }
}

main();
