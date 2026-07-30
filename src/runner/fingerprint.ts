// 指纹缓存:用 (eval 源码 + 运行配置) 的稳定哈希标识一次 attempt 的输入。
// 上次 passed 且指纹未变的 (experimentId, evalId) 组合可以直接携入,不再重跑。

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { sandboxRunInfo } from "../sandbox/resolve.ts";
import type { DiscoveredEval, EvalResult, JsonValue, SandboxOption } from "../types.ts";
import type { AgentRun } from "./types.ts";
import { prepareRunSandboxes, sandboxForEval } from "./sandbox-selection.ts";
import { selectedEvalsForRun } from "./eval-selection.ts";

export function cacheKey(run: AgentRun, evalId: string): string {
  return `${run.experimentId ?? ""}|${evalId}`;
}

/** Run 级配置身份。所有会改变结果解释口径的实验配置只在这里裁决一次。 */
export function computeConfigHash(run: AgentRun, configSandbox?: SandboxOption): string {
  const judge = run.judge;
  return hash({
    agent: run.agent.name,
    model: run.model,
    reasoningEffort: run.reasoningEffort,
    flags: run.flags,
    sandboxReuse: run.sandboxReuse ?? false,
    sandbox: sandboxRunInfo(run.sandbox ?? configSandbox),
    strict: run.strict ?? false,
    judge: judge ? { model: judge.model, baseUrl: judge.baseUrl } : undefined,
  });
}

export async function computeFingerprint(
  evalDef: DiscoveredEval,
  run: AgentRun,
  sourceCache?: Map<string, Promise<string>>,
  configSandbox?: SandboxOption,
): Promise<string> {
  const configHash = computeConfigHash(run, configSandbox);
  const source = await sourceClosure(evalDef, sourceCache);
  const loaderData = await Promise.all(
    [...(evalDef.loaderDataPaths ?? [])].sort().map(async (path) => [relative(process.cwd(), path), await cachedRead(path, sourceCache)]),
  );
  // 判据树(loadCriteria 登记)进的是「项目根相对路径 × 内容流式哈希」对:内容从不进内存,
  // 权限位与 mtime 不参与,所以重新 clone 一份工作树不作废。增删文件与改一字节同等作废——
  // 前者改的是这张对表的成员,后者改的是某一项的哈希。
  const criteria = await Promise.all(
    [...(evalDef.criteriaPaths ?? [])].sort().map(async (path) => [relative(process.cwd(), path), await cachedContentHash(path, sourceCache)]),
  );
  const payload = {
    configHash,
    source,
    eval: {
      id: evalDef.id,
      tags: evalDef.tags ?? [],
      environment: evalDef.environment,
      metadata: evalDef.metadata ?? {},
    },
    sandbox: sandboxRunInfo(sandboxForEval(run, evalDef, configSandbox)),
    loaderData,
    // 没登记判据树的 eval 完全不带这个键:空数组也会改变 payload 的字节,让所有存量结果
    // 一次性作废,而它们的判据面本来什么都没变。
    ...(criteria.length > 0 ? { criteria } : {}),
  };
  // timeoutMs(evalDef / run 两处来源)刻意不入哈希:超时上限不改变「结果是什么」,只决定
  // 「等不等得到」,把它掺进指纹会让单纯调高上限也作废全部已完成结果。它改用 planCarry 里的
  // 携带资格判据(durationMs ≤ 当前 resolved timeoutMs)参与,而不是指纹相等性
  // (见 docs/runner.md「缓存:指纹去重」)。
  return hash(payload);
}

async function cachedRead(path: string, cache?: Map<string, Promise<string>>): Promise<string> {
  let pending = cache?.get(path);
  if (!pending) {
    pending = readFile(path, "utf8");
    cache?.set(path, pending);
  }
  return pending;
}

/**
 * 判据树文件的内容哈希:流式算,几百个文件上百 MB 的判据树不整读进内存。
 * 与 `cachedRead` 共用同一张表,键加 `criteria:` 前缀——同一个文件可能既被 `loadText` 读入
 * (缓存的是内容)又被 `loadCriteria` 登记(缓存的是哈希),不分开两种值会互相顶掉。
 */
async function cachedContentHash(path: string, cache?: Map<string, Promise<string>>): Promise<string> {
  const key = `criteria:${path}`;
  let pending = cache?.get(key);
  if (!pending) {
    pending = streamHash(path);
    cache?.set(key, pending);
  }
  return pending;
}

async function streamHash(path: string): Promise<string> {
  const hasher = createHash("sha256");
  for await (const chunk of createReadStream(path)) hasher.update(chunk as Buffer);
  return hasher.digest("hex");
}

/** 项目内静态 import 图；外部包和动态 import 有意不进入闭包。 */
async function sourceClosure(evalDef: DiscoveredEval, cache?: Map<string, Promise<string>>): Promise<Array<[string, string]>> {
  const root = process.cwd();
  const visited = new Set<string>();
  const files: Array<[string, string]> = [];
  const visit = async (path: string): Promise<void> => {
    const absolute = resolve(path);
    if (visited.has(absolute) || !absolute.startsWith(`${root}/`) && absolute !== root) return;
    visited.add(absolute);
    const content = await cachedRead(absolute, cache);
    files.push([relative(root, absolute), content]);
    const specs = [...content.matchAll(/\b(?:import|export)\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/g)].map((m) => m[1]!);
    for (const spec of specs) {
      if (!spec.startsWith(".") && !spec.startsWith("/")) continue;
      const resolved = await resolveModule(dirname(absolute), spec);
      if (resolved) await visit(resolved);
    }
  };
  await visit(evalDef.sourcePath);
  return files.sort(([a], [b]) => a.localeCompare(b));
}

async function resolveModule(from: string, specifier: string): Promise<string | undefined> {
  const raw = resolve(from, specifier);
  const candidates = extname(raw) ? [raw] : [raw, ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx"].map((ext) => `${raw}${ext}`), ...["index.ts", "index.tsx", "index.js"].map((name) => resolve(raw, name))];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // 尝试下一个扩展名。
    }
  }
  return undefined;
}

export interface CarryPlan {
  /** `cacheKey(run, evalId)` → Run 级配置身份。 */
  plannedConfigHashes?: Map<string, string>;
  /** `cacheKey(run, evalId)` → 本次规划出的指纹,供调用方按同一口径判断"这条要不要携入"。 */
  plannedFingerprints: Map<string, string>;
  /**
   * `cacheKey(run, evalId)` → 这条组合**可以携带的全部指纹**:本次规划的那个,加上
   * 「只在 provenance flag 上与本次不同」的历史口径(见 `acceptableFingerprints`)。
   * 没声明 provenance flag 时恒是单元素集合 = `plannedFingerprints` 的那一个。
   * 携带判定一律读这个集合,`plannedFingerprints` 只用来给新跑的 attempt 落盘打戳。
   */
  acceptableFingerprints: Map<string, Set<string>>;
  /**
   * 携带以 attempt 为粒度:命中携入条件(该 attempt 自身 passed/failed 终态 + 指纹匹配)的
   * `${experimentId}|${evalId}` → 该 eval 下具体携入的 attempt 序号集合(0-based)。同一个
   * eval 在 `runs > 1` 时可能只有部分序号是终态、其余是 errored/未跑完——只有逐条命中的那些
   * 序号才在这个集合里,不是"key 命中就整段携入"(反例与修法见 memory 的
   * carry-includes-failed-verdict)。
   */
  carriedAttemptsByKey: Map<string, Set<number>>;
  /** carriedAttemptsByKey 对应的完整结果对象,供 run.ts 直接并入 summary、cli.ts 直接取 verdict 展示。 */
  carriedResults: EvalResult[];
  /** 仅迁移出口放行的历史条目及其审计键。 */
  carriedIgnoringFlagsByResult?: Map<EvalResult, readonly string[]>;
}

/**
 * 与 `attempt.ts` 里实际生效超时的解析顺序保持一致(`run.timeoutMs ?? evalDef.timeoutMs ??
 * configTimeoutMs`),但刻意不叠加 attempt.ts 的硬编码兜底(10 分钟):携带判据要问的是「用户
 * 有没有显式配置一条线」,三层都未设时线本身不存在,`Infinity` 让 durationMs 判据恒成立
 * (「当前未设上限 = 恒可携带」,见 docs/runner.md「缓存:指纹去重」)。10 分钟兜底是
 * attempt.ts 的执行期默认值,不是携带判据要遵守的线。
 */
export function resolvedTimeoutMsForCarry(run: AgentRun, evalDef: DiscoveredEval, configTimeoutMs?: number): number {
  return run.timeoutMs ?? evalDef.timeoutMs ?? configTimeoutMs ?? Infinity;
}

/**
 * 携带资格判据的**唯一**实现:从 `priorResults` 里挑出 `key` 这条 `(experimentId, evalId)`
 * 可以携入(跳过重跑)的 attempt。三条判据逐条 attempt 独立成立才算命中——
 *
 * 1. 该 attempt 自己是终态(`passed` / `failed`)。`errored` 是框架/环境层面的不确定失败,
 *    判定本身不可信;`unreadable` 根本没跑。同一 eval 的别的序号命中不能连带把它捎上
 *    (反例与修法见 memory 的 carry-must-be-per-attempt-not-whole-eval-key)。
 * 2. 该 attempt 落盘的 `fingerprint` 落在本次的可携带指纹集合里(`CarryPlan.acceptableFingerprints`
 *    的那一条,通常只有本次规划出的那一个;声明了 provenance flag 时还含「只在这些键上与本次
 *    不同」的历史口径)。
 * 3. 该 attempt 的 `durationMs` 不超过本次 resolved 的 `timeoutMs`——`timeoutMs` 是携带资格
 *    判据、不进指纹哈希(docs/runner.md「缓存:指纹去重」)。
 *
 * `planCarry`(整场静态规划)与 run.ts 派发时刻的携带重查共用这一个函数:两条路径一旦把判据
 * 各写一份就会分叉,重查会携入静态规划判过不可携带的条目(或反过来)。
 */
export function carriableAttempts(
  priorResults: EvalResult[] | undefined,
  key: string,
  configHash: string | undefined,
  fingerprints: ReadonlySet<string> | undefined,
  timeoutMs: number,
  options: { rerun?: "failed" | "all"; keepSandbox?: "failed" | "all"; sandboxReuse?: boolean; carryIgnoringFlags?: readonly string[] } = {},
): EvalResult[] {
  if (!priorResults?.length || fingerprints === undefined || fingerprints.size === 0) return [];
  const out: EvalResult[] = [];
  for (const r of priorResults) {
    if (!r.experimentId || `${r.experimentId}|${r.id}` !== key) continue;
    const isTerminalVerdict = r.verdict === "passed" || r.verdict === "failed";
    if (
      !isTerminalVerdict ||
      (r.configHash !== undefined && r.configHash !== configHash && !options.carryIgnoringFlags?.length) ||
      r.fingerprint === undefined ||
      !fingerprints.has(r.fingerprint) ||
      r.sandbox?.reused === true ||
      options.sandboxReuse === true ||
      options.rerun === "all" ||
      (options.rerun === "failed" && r.verdict === "failed") ||
      options.keepSandbox === "all" ||
      (options.keepSandbox === "failed" && r.verdict === "failed")
    ) continue;
    // `durationMs` 在 `EvalResult` 上是必填字段,正常落盘不会缺失;这里的 `typeof` 防御只处理
    // 磁盘数据损坏等异常情形——保守地判不可携带,而不是当 0 处理(当 0 会让所有旧记录都通过
    // 判据,把「数据缺失」悄悄伪装成「跑得很快」)。
    const executionMs =
      typeof r.executionMs === "number" && Number.isFinite(r.executionMs)
        ? r.executionMs
        : typeof r.durationMs === "number" && Number.isFinite(r.durationMs)
          ? r.durationMs
          : undefined;
    if (executionMs === undefined || executionMs > timeoutMs) continue;
    out.push(r);
  }
  return out;
}

/**
 * 算出这一批 (agentRun × eval) 的指纹,并据此从 priorResults 里筛出可以携入(跳过重跑)的结果。
 * run.ts 与 cli.ts(live 表格构建)必须共用这同一份计算 —— 否则两边一旦对"哪些携入"的判断
 * 不一致,live 表格就会显示"还在等名额",而 run.ts 其实已经把它筛掉、根本不会调度这个 attempt
 * (见 memory 的 live-carry-row-shows-waiting-forever)。
 *
 * 携带来源不要求快照收尾:`priorResults` 来自 `loadLatestResultsPerEval`,它按落盘的
 * `result.json` 一条条读,不检查所属快照有没有 `completedAt`——被中断或强杀的 run 留下的
 * 未收尾快照,其中已落盘的终态 attempt 同样进入这里的候选集合(见 docs/runner.md
 * 「缓存:指纹去重」)。
 *
 * @param configTimeoutMs 项目级 `Config.timeoutMs`(携带资格判据的最后一层兜底,见
 * `resolvedTimeoutMsForCarry`)。省略时按未配置处理,不是当作 0——只有 `run.timeoutMs` /
 * `evalDef.timeoutMs` 都缺席时才轮到它兜底。
 */
export async function planCarry(
  evals: DiscoveredEval[],
  agentRuns: AgentRun[],
  priorResults: EvalResult[] | undefined,
  configSandbox?: SandboxOption,
  configTimeoutMs?: number,
  options: { rerun?: "failed" | "all"; keepSandbox?: "failed" | "all"; carryIgnoringFlags?: readonly string[] } = {},
): Promise<CarryPlan> {
  prepareRunSandboxes(evals, agentRuns, configSandbox);
  const sourceCache = new Map<string, Promise<string>>();
  const plannedFingerprints = new Map<string, string>();
  const plannedConfigHashes = new Map<string, string>();
  // 与 plannedFingerprints 同一批 (run × evalDef) 循环里顺带算好,供下面按 key 查「这个组合
  // 这次的携带资格线是多少」——同一个 key 在同一次 planCarry 调用里只对应一个 (run, evalDef)
  // 组合,与 plannedFingerprints 的 key 语义一致。
  const plannedTimeoutMs = new Map<string, number>();
  const acceptable = new Map<string, Set<string>>();
  const jobs: Promise<void>[] = [];
  for (const run of agentRuns) {
    for (const evalDef of selectedEvalsForRun(evals, run)) {
      const key = cacheKey(run, evalDef.id);
      const configHash = computeConfigHash(run, configSandbox);
      run.configHash = configHash;
      plannedConfigHashes.set(key, configHash);
      plannedTimeoutMs.set(key, resolvedTimeoutMsForCarry(run, evalDef, configTimeoutMs));
      jobs.push(
        (async () => {
          const fp = await computeFingerprint(evalDef, run, sourceCache, configSandbox);
          plannedFingerprints.set(key, fp);
          acceptable.set(key, new Set([fp]));
        })(),
      );
    }
  }
  await Promise.all(jobs);

  // 搬迁出口只允许忽略已从本次 flags 移走的键。历史条目仍按它落盘时的整袋 flags
  // 重算指纹；只有删去这些键后其余 flags 与本次完全一致，才把那份旧口径加入候选。
  const ignored = options.carryIgnoringFlags ?? [];
  if (ignored.length > 0) {
    for (const prior of priorResults ?? []) {
      const key = prior.experimentId === undefined ? undefined : `${prior.experimentId}|${prior.id}`;
      const historicalFlags = prior.experiment?.flags;
      if (key === undefined || historicalFlags === undefined || !acceptable.has(key)) continue;
      const run = agentRuns.find((candidate) => cacheKey(candidate, prior.id) === key);
      const evalDef = evals.find((candidate) => candidate.id === prior.id);
      if (run === undefined || evalDef === undefined || !ignored.every((flag) => Object.hasOwn(historicalFlags, flag))) continue;
      const withoutIgnored = Object.fromEntries(Object.entries(historicalFlags).filter(([flag]) => !ignored.includes(flag)));
      if (stableJson(withoutIgnored) !== stableJson(run.flags)) continue;
      acceptable.get(key)!.add(await computeFingerprint(evalDef, { ...run, flags: historicalFlags }, sourceCache, configSandbox));
    }
  }

  // 判据本身在 carriableAttempts 里,这里只按 key 逐组调它——静态规划与派发时刻的重查因此
  // 不可能对「哪些携入」得出不同结论。
  const carriedAttemptsByKey = new Map<string, Set<number>>();
  const carriedIgnoringFlagsByResult = new Map<EvalResult, readonly string[]>();
  const hit = new Set<EvalResult>();
  for (const [key] of plannedFingerprints) {
    const evalId = key.slice(key.indexOf("|") + 1);
    const run = agentRuns.find((candidate) => cacheKey(candidate, evalId) === key);
    const carried = carriableAttempts(
      priorResults,
      key,
      plannedConfigHashes.get(key),
      acceptable.get(key),
      plannedTimeoutMs.get(key) ?? Infinity,
      { ...options, sandboxReuse: run?.sandboxReuse },
    );
    if (carried.length === 0) continue;
    const indices = new Set<number>();
    for (const r of carried) {
      indices.add(r.attempt);
      hit.add(r);
      if (ignored.length > 0 && r.fingerprint !== plannedFingerprints.get(key)) {
        carriedIgnoringFlagsByResult.set(r, ignored);
      }
    }
    carriedAttemptsByKey.set(key, indices);
  }
  // 按 priorResults 的原始顺序输出(调用方的展示顺序不因分组而抖动)。
  const carriedResults = (priorResults ?? []).filter((r) => hit.has(r));
  return { plannedConfigHashes, plannedFingerprints, acceptableFingerprints: acceptable, carriedAttemptsByKey, carriedResults, carriedIgnoringFlagsByResult };
}

function hash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

/** 键序稳定的 JSON 序列化(对象键排序),保证同一 payload 永远同一指纹。 */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const obj = value as globalThis.Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`)
    .join(",")}}`;
}
