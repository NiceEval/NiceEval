// 生成本仓库所有 scripts/verify-<domain>.ts 模块共同断言的「唯一一份」证据
// (docs/engineering/testing/e2e/report.md:"一次真实运行产出的证据被下面
// 全部验收组共用,断言条数不增加模型成本")。只运行一次三个 Experiment,只导出一次真实的
// 静态站点,并返回一个结构化的 `Evidence` 对象,携带每个 verify-<domain>.ts 模块做断言所需的
// 全部 locator/路径——这样新增的 domain 永远不需要重新跑一次 Experiment,也不需要自己扫描
// `.niceeval/` 去反推 locator。
//
// 本模块只负责「产出」证据,并断言给它定型所需的最小结构形状(attempt 目录数量、locator 格式)。
// 它不对照 report.md 的 format/rendering/read-back 契约去评判这份证据——那是每个
// verify-<domain>.ts 自己的工作,它们读取这里返回的路径/locator 去做判断。

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { sh } from "./sh.ts";

const RESULTS_ROOT = ".niceeval";
const SITE_EXPORT_DIR = "site-export";
const LOCATOR_RE = /^@[0-9a-z]{8}$/;
const PROVIDER_FAULT_RE = /errored.*(429|5\d\d|ECONNREFUSED|ETIMEDOUT)/i;

/** 只在 main Experiment 的真实网关调用失败时抛出——具体的退出码分类见 scripts/e2e.ts。 */
export class InfraError extends Error {}

export type Verdict = "passed" | "failed" | "skipped" | "errored";

/** 单个 attempt 的定位信息——足够用来执行 `niceeval show @<locator> ...` 或直接读取它的文件。 */
export interface AttemptEvidence {
  /** 该 attempt 所属的 eval id(例如 "tool-call"、"deliberate-fail"、"deliberate-error")。 */
  evalId: string;
  /** 该 attempt 的真实 verdict,是本次运行实际产生的——从磁盘读出来的,不是假设的。 */
  verdict: Verdict;
  /** 不透明的 `@<locator>` 字符串,可直接用于 `niceeval show @<locator>`、`--exp` 等场景。 */
  locator: string;
  /** 该 attempt 存放 result.json/events.json/sources.json/o11y.json 的目录,相对于仓库根目录(脚本运行时的 cwd)。 */
  attemptDir: string;
}

/** 本仓库三个 Experiment 中某一个的结构化证据。 */
export interface Evidence {
  /** 三个 Experiment 共用的 results 根目录——传给 `openResults()` 或 `--results`。相对于仓库根目录;脚本运行时 cwd 就是仓库根目录。 */
  resultsRoot: string;
  /** 本次运行对应的 `niceeval view --out` 导出目录——真实的静态站点,由 rendering/CLI-readback 各 domain 共用。相对于仓库根目录。 */
  siteExportDir: string;
  /** main:"tool-call" 的 `runs: 2` 次真实网关 attempt,均预期为 passed。 */
  main: {
    id: "main";
    evalId: "tool-call";
    /** 本次运行的快照目录,`.niceeval/main/<timestamp-suffix>/`。 */
    snapshotDir: string;
    /** 两次真实 attempt(长度为 2)。 */
    attempts: AttemptEvidence[];
  };
  /** deliberate-fail:恰好 1 个确定性失败的 attempt。 */
  deliberateFail: {
    id: "deliberate-fail";
    evalId: "deliberate-fail";
    snapshotDir: string;
    attempt: AttemptEvidence;
  };
  /** deliberate-error:恰好 1 个确定性出错的 attempt。 */
  deliberateError: {
    id: "deliberate-error";
    evalId: "deliberate-error";
    snapshotDir: string;
    attempt: AttemptEvidence;
  };
  /** 每次 Experiment 调用产出的 JUnit 文件,相对于仓库根目录。 */
  junit: { main: string; fail: string; error: string };
  /** main Experiment 调用产出的 `--json` 机器可读摘要路径,相对于仓库根目录。 */
  jsonSummaryPath: string;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** 预期恰好存在一个子目录(例如一次 --force 运行后唯一的快照目录)。绝不硬编码 timestamp+suffix 这个名字。 */
function singleSubdir(dir: string, context: string): string {
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  assert.equal(names.length, 1, `expected exactly one directory under ${dir} (${context}), found ${names.length}: ${names.join(", ")}`);
  return join(dir, names[0]);
}

function subdirNames(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/**
 * 和 `sh` 一样,但专用于那种预期退出码为 0 的命令(真实网关调用):
 * 当 `--output ci` 自身的文本内容证实是 provider 端故障(429/5xx/网络问题)时——文档规定的
 * 「可确认的外部故障」信号(docs/engineering/testing/e2e/verification.md「失败分类」)——这里
 * 出现意料之外的非零退出会抛出 InfraError,而不是普通的 AssertionError。除此之外的情况一律
 * 视为回归问题。
 */
function shExpectZero(cmd: string): string {
  const res = spawnSync(cmd, { shell: true, encoding: "utf8" });
  const exit = res.status ?? -1;
  if (exit === 0) return res.stdout;
  const combined = `${res.stdout}\n${res.stderr}`;
  if (PROVIDER_FAULT_RE.test(combined)) {
    throw new InfraError(`${cmd} exited ${exit} with a provider-side fault visible in --output ci text:\n${combined.slice(-3000)}`);
  }
  throw new Error(`${cmd}\nexited ${exit}, expected 0. stdout/stderr tail:\n${combined.slice(-3000)}`);
}

/** 读回某个 Experiment 的单 attempt 结果(deliberate-fail / deliberate-error 的形状)。 */
function readSingleAttempt(experimentId: string, evalId: string): { snapshotDir: string; attempt: AttemptEvidence } {
  const expDir = join(RESULTS_ROOT, experimentId);
  assert.ok(existsSync(expDir), `${expDir} missing — the ${experimentId} Experiment produced no experiment directory`);
  const snapshotDir = singleSubdir(expDir, `${experimentId} experiment directory after a single --force run`);
  const evalDir = join(snapshotDir, evalId);
  const attemptDirNames = subdirNames(evalDir);
  assert.equal(attemptDirNames.length, 1, `expected exactly 1 attempt directory under ${evalDir}, found ${attemptDirNames.length}: ${attemptDirNames.join(", ")}`);
  const attemptDir = join(evalDir, attemptDirNames[0]!);
  const result = readJson<{ verdict: Verdict; locator?: string }>(join(attemptDir, "result.json"));
  assert.ok(LOCATOR_RE.test(result.locator ?? ""), `result.json.locator "${result.locator}" in ${attemptDir} doesn't match the @<7 base36 chars> shape`);
  return { snapshotDir, attempt: { evalId, verdict: result.verdict, locator: result.locator!, attemptDir } };
}

/**
 * 只运行一次本仓库的三个 Experiment,导出一次合并结果的静态站点,并返回每个
 * verify-<domain>.ts 模块所需的定位信息。
 */
export async function produceEvidence(): Promise<Evidence> {
  // ---------------------------------------------------------------------
  // deliberate-fail / deliberate-error 故意排在最前面运行:它们从不调用真实网关,所以无论 main
  // Experiment 的真实 HTTP 调用是否成功,它们产出的证据都是可用的——一个故意写坏的
  // deliberate-fail/error Eval 会在这里就直接失败,而不会被之后 main experiment 一个不相关的
  // 失败所掩盖。
  // ---------------------------------------------------------------------
  sh("pnpm exec niceeval exp deliberate-fail --force --output ci --junit fail.xml", "nonzero");
  sh("pnpm exec niceeval exp deliberate-error --force --output ci --junit error.xml", "nonzero");

  // ---------------------------------------------------------------------
  // 真实网关调用,放在最后。
  // ---------------------------------------------------------------------
  shExpectZero("pnpm exec niceeval exp main --force --output ci --json main.json --junit main.xml");

  const deliberateFail = readSingleAttempt("deliberate-fail", "deliberate-fail");
  const deliberateError = readSingleAttempt("deliberate-error", "deliberate-error");

  const mainExpDir = join(RESULTS_ROOT, "main");
  assert.ok(existsSync(mainExpDir), `${mainExpDir} missing — the main Experiment produced no experiment directory`);
  const mainSnapshotDir = singleSubdir(mainExpDir, "main experiment directory after a single --force run");
  const mainEvalDir = join(mainSnapshotDir, "tool-call");
  const mainAttemptDirNames = subdirNames(mainEvalDir);
  assert.equal(
    mainAttemptDirNames.length,
    2,
    `expected 2 attempt directories under ${mainEvalDir} (runs:2, earlyExit:false), found ${mainAttemptDirNames.length}: ${mainAttemptDirNames.join(", ")}`,
  );
  const mainAttempts: AttemptEvidence[] = mainAttemptDirNames.map((name) => {
    const attemptDir = join(mainEvalDir, name);
    const result = readJson<{ verdict: Verdict; locator?: string }>(join(attemptDir, "result.json"));
    assert.ok(LOCATOR_RE.test(result.locator ?? ""), `result.json.locator "${result.locator}" in ${attemptDir} doesn't match the @<7 base36 chars> shape`);
    return { evalId: "tool-call", verdict: result.verdict, locator: result.locator!, attemptDir };
  });

  // ---------------------------------------------------------------------
  // 三个 Experiment 现已全部运行完毕,并在 RESULTS_ROOT 下共存(passed/failed/errored)。
  // 只导出一次合并结果的静态站点,供每个 rendering/CLI-readback 的 verify-<domain>.ts
  // 模块共用——没有哪个 domain 会重新导出自己的一份站点。
  // ---------------------------------------------------------------------
  sh(`pnpm exec niceeval view --out ${SITE_EXPORT_DIR}`);

  return {
    resultsRoot: RESULTS_ROOT,
    siteExportDir: SITE_EXPORT_DIR,
    main: { id: "main", evalId: "tool-call", snapshotDir: mainSnapshotDir, attempts: mainAttempts },
    deliberateFail: { id: "deliberate-fail", evalId: "deliberate-fail", snapshotDir: deliberateFail.snapshotDir, attempt: deliberateFail.attempt },
    deliberateError: { id: "deliberate-error", evalId: "deliberate-error", snapshotDir: deliberateError.snapshotDir, attempt: deliberateError.attempt },
    junit: { main: "main.xml", fail: "fail.xml", error: "error.xml" },
    jsonSummaryPath: "main.json",
  };
}
