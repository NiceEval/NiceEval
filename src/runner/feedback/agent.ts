// Agent profile renderer(见 docs/feature/experiments/cli.md「AI agent 怎么用」)。
//
// 目标读者是调用 niceeval 的 coding agent,不是人眼:
// - 运行中只有一条稳定 ASCII `key=value` envelope,`stderr` 追加,不含 ANSI、不依赖终端宽度、
//   字段名不随 `NICEEVAL_LANG` 变化(与 human 相对——human 走 i18n,agent 永远是这一份固定英文)。
// - 结束时 `stdout` 只有一个有界 handoff block:status、verdict summary、快照、最多 5 条失败、
//   每条失败的结构化主断言摘要(执行错误退回 reason)、以及可执行的 `show` 下钻命令。
//   handoff 不内联 transcript/trace/源码/diff,
//   agent 要看这些必须自己再发一条 `niceeval show @locator ...`(locator 是唯一的继续调查主键)。
//
// 不实现 `clearDynamic`/`redrawDynamic`/`activity`/`onLifecycle`:agent 没有「动态区域」概念,
// 不展示 active phase、不逐次输出 provisioning retry/backoff、不逐条打印 passed attempt —— 这些
// 目标行为由「不实现对应可选钩子」天然满足(见 renderer.ts 的接口注释),不需要在这里写
// `if (profile === "agent")` 分支。
//
// 与 human.ts 刻意不共享任何内部函数/类型(哪怕字面意思相同,如 group 推导、verdict 优先级)——
// 两个 renderer 各自独立成立,不应该因为共享一个私有 helper 而在未来被迫同步重构。
//
// 为什么「立即追加」的第一行不是在 "plan" 事件本身同步打印:
//   reducer 处理 "plan" 事件之后,`running` 恒为 0(所有非携入 attempt 此刻都还在 `queued`,
//   还没有一个 `attempt:start` 落地)——这是 reducer 的确定性契约(见 reducer.test.ts),不是
//   这个 renderer 能绕过的。cli.md 给出的例子第一行却是 `running=4 queued=0`:那是「调度已经
//   把前几个 attempt 派发出去之后」的真实快照,不是 "plan" 那一刻的状态。硬要在 "plan" 上同步
//   打印,只会打印出一条与调度实际不符的假 "running=0" 行。这里改为:"plan" 到达时只记录一个
//   内部锚点(不打印),第一次 tick(默认 250ms 内)无条件打印一次(不受 30 秒空闲阈值约束)——
//   这样真实调度已经有机会把初始一批 attempt 派发出去,打印出的数字就是「此刻真实的调度快照」,
//   同时 elapsed 按整秒取整后仍然显示 "0s",满足「start 立即追加」——不是「精确到毫秒的
//   plan 事件本身」,而是「第一次有意义的重画机会」。
//
// 为什么 error 的 checkpoint 行不像 cli.md 正文另一处例子那样拆 `code=`/`message=`:
//   `FailureNotice` 的执行错误仍只有一个整句 `reason` 字段(如
//   "sandbox-rate-limit: E2B sandbox allocation failed after 5 attempts"),没有独立的 error code
//   字段。把它按冒号切成 `code=`/`message=` 两段需要解析这句人类文案的格式约定,这正是
//   plan 顶层「不接受」清单明确禁止的「Agent/CI 解析 human 文案」——即便这句文案*看起来*总是
//   "code: message" 形状,依赖这个约定本身就是在解析。这里改为只输出类型里已有的结构化字段
//   (locator/eval/experiment/phase/verdict)。failed assertion 已另带结构化摘要；error 的
//   `reason` 留给有界的最终 handoff 逐条列出(那里是
//   独立的一行文本,不是 key=value 字段,不需要被下游再解析出子字段)。见本文件顶部大注释。

import type { FeedbackRenderer } from "./renderer.ts";
import type { FeedbackIO } from "./io.ts";
import type { DurableFeedbackEvent, FailureNotice, RunCompletion, RunFeedbackState, RunSummary } from "../types.ts";
import { assertionSummaryLines } from "../../scoring/display.ts";

/** 失败/errored checkpoint 与最终 handoff 共用同一个展开上限(cli.md「'立即追加'也必须有
 *  上限」表:agent 前 5 条)。 */
const AGENT_FAILURE_CAP = 5;
/** 最终 handoff 的快照路径同样「有界」(checklist:「最终 stdout handoff 有界:...快照...」),
 *  但 cli.md 没有给出具体数字——沿用与失败同一个上限,保持模块内单一、可预测的边界规则,
 *  而不是为「快照」再发明一个不同的魔法数字。 */
const AGENT_SNAPSHOT_CAP = AGENT_FAILURE_CAP;
/** `--dry --output agent` 的 PLAN 行展开上限。cli.md 给出的唯一例子(5 个组合只展开 2 行 +
 *  "… 3 more")没有配套的文字规则(不像失败上限有明确的「agent 前 5 条」措辞),这个具体数字
 *  是从那一个例子反推出来的,不是 docs 正文声明的产品规则——如果 stage G 接线时发现真实矩阵
 *  需要不同的预览粒度,`renderAgentPlanEnvelope` 的 `rowCap` 参数可以覆盖这个默认值,不需要
 *  改这个模块。 */
const AGENT_PLAN_ROW_CAP = 2;
/** 连续无永久事件多久才追加一条 heartbeat(cli.md:「连续 30 秒无永久事件才 heartbeat」)。 */
const AGENT_HEARTBEAT_IDLE_MS = 30_000;

export interface AgentRendererOptions {
  io: FeedbackIO;
}

/**
 * 创建 agent profile 的 `FeedbackRenderer`。只用 `io.stdout`/`io.stderr` 写文本,不读
 * `io.stderr.isTTY`/`columns`/`rows`——agent 输出「不依赖终端宽度」,不像 human 那样有
 * TTY/非 TTY 两个变体。
 */
export function createAgentRenderer(options: AgentRendererOptions): FeedbackRenderer {
  const { io } = options;

  // 距上一次「有意义的输出」(第一次 tick 打印,或任意一次永久事件)过了多久,用来判断要不要
  // 追加一条 heartbeat;由 appendDurable 无条件更新(见 checklist「failure/warning 后重置心跳
  // 时钟」——这里把「warning」理解成任意永久事件,不止 diagnostic 一种,与 human 非 TTY 变体的
  // 同名字段语义一致,但两个模块互不依赖,各自独立维护)。
  let lastCheckpointAtMs = 0;
  let printedFirstCheckpoint = false;
  // "summary" 与 "saved" 是 coordinator.finish() 里连续 emit 的两个独立永久事件(见
  // coordinator.ts 的 finish() 实现,中间不会插入其它事件)——handoff 需要两者合并成一个
  // stdout block,所以在 "summary" 到达时先记下来,"saved" 到达时才真正拼出并写一次。
  let pendingSummary: { summary: RunSummary; completion: RunCompletion; reused: number } | undefined;

  function noteCheckpoint(atMs: number): void {
    lastCheckpointAtMs = atMs;
  }

  return {
    appendDurable(event, state) {
      switch (event.type) {
        case "plan":
          // 不同步打印:见文件顶部「为什么第一行不是在 plan 上同步打印」。只记锚点,交给
          // 第一次 tick 无条件打印。
          noteCheckpoint(event.at);
          return;

        case "failure": {
          noteCheckpoint(event.at);
          writeFailureCheckpoint(io, event, state.freshFailureCount);
          return;
        }

        case "diagnostic": {
          noteCheckpoint(event.at);
          if (!isFirstOccurrence(state, event.key)) return; // 去重后只追加一次(checklist)
          io.stderr.write(
            `${envelopeWord(event.severity)} ${kv("key", event.key)}${
              event.identity?.evalId ? ` ${kv("eval", event.identity.evalId)}` : ""
            }${event.identity?.experimentId ? ` ${kv("experiment", event.identity.experimentId)}` : ""} ${kv(
              "message",
              event.message,
            )}\n`,
          );
          return;
        }

        case "budget-exhausted": {
          noteCheckpoint(event.at);
          if (!isFirstOccurrence(state, `budget-exhausted:${event.experimentId}`)) return;
          io.stderr.write(
            `NICEEVAL budget_exhausted ${kv("experiment", event.experimentId)} ${kv(
              "spent",
              event.spent.toFixed(2),
            )} ${kv("unstarted", event.unstarted)}\n`,
          );
          return;
        }

        case "experiment-hook": {
          // 实验级钩子起止各一行(见 cli.md「实验级钩子的显示」):agent 没有动态区域,
          // 长 setup 期间只有 heartbeat 的日志无法区分「钩子在跑」和「挂死」。
          noteCheckpoint(event.at);
          const word = event.hook === "setup" ? "experiment_setup" : "experiment_teardown";
          const parts = [`NICEEVAL ${word}`, kv("experiment", event.experimentId), kv("status", event.status)];
          if (event.durationMs !== undefined) parts.push(kv("duration", formatElapsedSeconds(event.durationMs)));
          io.stderr.write(parts.join(" ") + "\n");
          return;
        }

        case "interrupted": {
          noteCheckpoint(event.at);
          if (!isFirstOccurrence(state, "interrupted")) return;
          io.stderr.write(`NICEEVAL interrupted ${kv("elapsed", formatElapsedSeconds(state.elapsedMs))}\n`);
          return;
        }

        case "reporter-error": {
          noteCheckpoint(event.at);
          if (!isFirstOccurrence(state, `reporter-error:${event.reporter}`)) return;
          io.stderr.write(
            `NICEEVAL reporter_error ${kv("reporter", event.reporter)} ${kv("required", event.required)} ${kv(
              "message",
              event.message,
            )}\n`,
          );
          return;
        }

        case "summary":
          // 只记录,不写——见上方 pendingSummary 注释。reused 只在 RunFeedbackState 上,
          // RunSummary 本身没有这个字段,所以在这里(还能读到最新 state)一并存下来。
          pendingSummary = { summary: event.summary, completion: event.completion, reused: state.reused };
          return;

        case "kept":
          // 单行 kept 事件(与 run 事件同一 key=value 词法,见 docs/feature/sandbox/cli.md)。
          io.stderr.write(
            [
              "NICEEVAL kept",
              kv("locator", String(event.locator)),
              kv("eval", event.identity.evalId),
              kv("attempt", String(event.identity.attempt)),
              kv("verdict", event.verdict),
              kv("provider", event.provider),
              kv("sandbox", event.sandboxId),
              kv("enter", `niceeval sandbox enter ${event.sandboxId.slice(0, 12)}`),
            ].join(" ") + "\n",
          );
          return;

        case "saved":
          writeHandoff(io, pendingSummary, event.paths, state.failures, state.kept.length > 0);
          return;

        default: {
          // 穷尽性检查:新增 DurableFeedbackEvent 变体时这里编译期报错提醒补上对应分支。
          const exhaustive: never = event;
          return exhaustive;
        }
      }
    },

    onTick(event, state) {
      const idle = event.at - lastCheckpointAtMs;
      if (printedFirstCheckpoint && idle < AGENT_HEARTBEAT_IDLE_MS) return;
      printedFirstCheckpoint = true;
      noteCheckpoint(event.at);
      io.stderr.write(progressLine(state, event.elapsedMs) + "\n");
    },

    // 没有 clearDynamic/redrawDynamic/activity/onLifecycle:见文件顶部注释——agent 不维护
    // 动态区域、不逐次输出 provisioning retry/backoff、不逐条展示 active phase,这些由「不实现
    // 对应可选钩子」天然满足(renderer.ts 的接口注释同样这样描述 agent/ci)。
  };
}

/** 某个去重 key 在 `state.diagnostics` 里是不是第一次出现(count === 1)。budget-exhausted /
 *  interrupted / reporter-error 的去重 key 计算方式与 reducer.ts 完全一致(见该文件的
 *  `budget-exhausted:${experimentId}` / `"interrupted"` / `reporter-error:${reporter}`),
 *  两处必须同源,不能各写一份 —— 这里选择直接复刻字符串拼法(而不是从 reducer.ts 导出常量),
 *  因为这几个 key 是 `DurableFeedbackEvent` 自身语义的一部分(agent/ci/human 三个 renderer
 *  都需要各自能算出同一个 key),不是 reducer 实现细节。 */
function isFirstOccurrence(state: RunFeedbackState, key: string): boolean {
  return (state.diagnostics.find((d) => d.key === key)?.count ?? 0) <= 1;
}

function envelopeWord(severity: "warning" | "error"): string {
  return severity === "error" ? "NICEEVAL error" : "NICEEVAL warning";
}

// ───────────────────────── 字段转义 / envelope 拼装(纯函数) ─────────────────────────

type FieldValue = string | number | boolean;

/** 字段值需要空格(或引号)时用 JSON string 转义,不依赖 locale、不需要下游猜测分隔规则
 *  (checklist:「字段值需要空格时使用 JSON string 转义」)。没有空格/引号的值保持裸 token,
 *  这样最常见的 id/数字/枚举值(eval id、locator、phase……)仍然是最省 token 的形态。 */
function escapeFieldValue(raw: string): string {
  return /[\s"]/.test(raw) ? JSON.stringify(raw) : raw;
}

function kv(key: string, value: FieldValue): string {
  return typeof value === "string" ? `${key}=${escapeFieldValue(value)}` : `${key}=${value}`;
}

/** "0s" / "30s" / "75s" 风格——cli.md 全部 agent 例子只用到整秒,没有出现过 "1m 15s" 这种
 *  human 专用的分钟切换,这里就不实现那个格式,避免多一种 agent 从未用到的输出形态。 */
function formatElapsedSeconds(ms: number): string {
  return `${Math.max(0, Math.floor(ms / 1000))}s`;
}

function progressLine(state: RunFeedbackState, elapsedMs: number): string {
  return [
    "NICEEVAL progress",
    kv("elapsed", formatElapsedSeconds(elapsedMs)),
    kv("total", state.total),
    kv("reused", state.reused),
    kv("running", state.running),
    kv("queued", state.queued),
    kv("completed", state.completed),
  ].join(" ");
}

// ───────────────────────── failure / error checkpoint(stderr,立即追加,带上限) ─────────────────────────

function writeFailureCheckpoint(io: FeedbackIO, event: DurableFeedbackEvent & { type: "failure" }, countSoFar: number): void {
  if (countSoFar === AGENT_FAILURE_CAP + 1) {
    // 越过上限的第一条给一次 suppressed 提示,不是每条失败都重复一遍——不然「追加一次」会变成
    // 新的刷屏源(与 human.ts 对同一权衡的处理方式一致,但这里是独立实现,不复用它的代码)。
    // 必须在下面的「> CAP 一律静默」之前判断,否则这个分支永远不可达。
    io.stderr.write(
      `NICEEVAL warning ${kv("key", "failures-suppressed")} ${kv(
        "message",
        "further failed/errored attempts are not streamed individually; see the final result",
      )}\n`,
    );
    return;
  }
  if (countSoFar > AGENT_FAILURE_CAP) return; // 上限之后完全静默,靠最终 handoff 给出准确总数
  const parts = [
    event.verdict === "errored" ? "NICEEVAL error" : "NICEEVAL failure",
    kv("locator", event.locator),
    kv("eval", event.identity.evalId),
  ];
  if (event.identity.experimentId) parts.push(kv("experiment", event.identity.experimentId));
  if (event.phase) parts.push(kv("phase", event.phase));
  parts.push(kv("verdict", event.verdict));
  io.stderr.write(parts.join(" ") + "\n");
}

// ───────────────────────── 最终 handoff(stdout,有界,一次性写完) ─────────────────────────

/** required reporter(默认 artifacts、显式 --json/--junit)写失败必须让 handoff 判红,即便全部
 *  attempt 都通过——它不是 CompletionStatus 的第四个值(那个枚举只有
 *  complete/incomplete/interrupted 三态),但和 ci.ts 的 resultStatusWord() 同一条判断:
 *  退出码已经因它非零(见 computeCiExitCode),handoff 不能反过来印一个会被误读成
 *  "全绿"的 passed。 */
function resultStatusWord(completion: RunCompletion, summary: RunSummary): string {
  if (completion.status === "interrupted") return "interrupted";
  if (completion.status === "incomplete") return "incomplete";
  if (completion.reporterErrors.some((e) => e.required)) return "failed";
  return summary.failed > 0 || summary.errored > 0 ? "failed" : "passed";
}

function summaryLine(summary: RunSummary, completion: RunCompletion, reused: number): string {
  const paren = [`${reused} reused`];
  if (completion.unstarted > 0) paren.push(`${completion.unstarted} unstarted`);
  return `summary: ${summary.passed} passed, ${summary.failed} failed, ${summary.errored} errored (${paren.join(", ")})`;
}

/** 快照路径的共同「组」段(如 `.niceeval/compare/bub-e2b/<snapshot>` → `compare`),用于
 *  over-limit 提示里的 `niceeval view <group>`。多个 experiment 组混在一次 invocation 里时
 *  组名不唯一,不猜一个可能错的 view 目标。与 human.ts 里同名逻辑刻意分开实现(见文件顶部
 *  注释),不是共享同一个函数。 */
function deriveResultGroup(paths: readonly string[]): string | undefined {
  const groups = new Set<string>();
  for (const p of paths) {
    const seg = p.split("/")[1];
    if (seg) groups.add(seg);
  }
  return groups.size === 1 ? [...groups][0] : undefined;
}

function writeHandoff(
  io: FeedbackIO,
  pending: { summary: RunSummary; completion: RunCompletion; reused: number } | undefined,
  paths: readonly string[],
  failures: readonly FailureNotice[],
  hasKept = false,
): void {
  if (!pending) return; // 不应发生:coordinator.finish() 恒先 emit "summary" 再 emit "saved"。
  const { summary, completion, reused } = pending;
  const lines: string[] = [
    `NICEEVAL RESULT ${resultStatusWord(completion, summary)}`,
    summaryLine(summary, completion, reused),
  ];

  if (paths.length > 0) {
    lines.push("snapshots:");
    for (const p of paths.slice(0, AGENT_SNAPSHOT_CAP)) lines.push(`  - ${p}`);
    if (paths.length > AGENT_SNAPSHOT_CAP) lines.push(`  … ${paths.length - AGENT_SNAPSHOT_CAP} more`);
  }

  if (failures.length > 0) {
    const shown = failures.slice(0, AGENT_FAILURE_CAP);
    if (failures.length > AGENT_FAILURE_CAP) {
      const group = deriveResultGroup(paths);
      const hint = group ? `run \`niceeval view ${group}\`` : "check the results directory";
      lines.push(`failures: ${failures.length} total, showing ${AGENT_FAILURE_CAP}`);
      for (const f of shown) lines.push(...handoffFailureLines(f));
      lines.push(`  … ${failures.length - AGENT_FAILURE_CAP} more; inspect the JSON result or ${hint}`);
    } else {
      lines.push("failures:");
      for (const f of shown) lines.push(...handoffFailureLines(f));
    }
    // 下钻命令只给第一条失败做示范,不逐条重复三行(与「有界 handoff」的整体原则一致——
    // 逐条重复会让「有界」变成新的刷屏源)。
    const first = shown[0]!;
    lines.push("next:");
    lines.push(`  niceeval show ${first.locator}`);
    lines.push(`  niceeval show ${first.locator} --eval`);
    lines.push(`  niceeval show ${first.locator} --execution`);
    lines.push(`  niceeval show ${first.locator} --diff`);
    if (hasKept) lines.push("  niceeval sandbox stop --all");
  } else if (hasKept) {
    lines.push("next:");
    lines.push("  niceeval sandbox stop --all");
  }

  io.stdout.write(lines.join("\n") + "\n");
}

function handoffFailureLines(f: FailureNotice): string[] {
  const bracket = f.identity.experimentId ?? f.who;
  const summary = f.assertion ? assertionSummaryLines(f.assertion) : [f.reason];
  return [
    `  - ${f.locator} ${f.identity.evalId} [${bracket}]`,
    ...summary.map((line, index) => `${index === 0 ? "    " : "      "}${line}`),
  ];
}

// ───────────────────────── `--dry --output agent`:稳定 PLAN envelope ─────────────────────────

/** 一个 (config, eval) 组合在 PLAN 预览里的一行。`label` 推荐传完整 `experimentId`(带 group
 *  前缀,如 `compare/bub-e2b`,不是 `runWho()` 的 basename——cli.md 的 PLAN 例子里两行分别是
 *  `compare/bub-e2b`/`compare/codex`,是完整 experimentId);没有 experiment 时调用方可以传
 *  `runWho()` 的结果做退回。这个模块不替调用方决定用哪个,只按给定的字符串渲染。 */
export interface AgentPlanRow {
  label: string;
  evalId: string;
}

export interface AgentDryPlanInput {
  /** 总 attempt 数(= evals × configs × runs)。 */
  total: number;
  /** 去重后的 eval 数。 */
  evals: number;
  /** (agent, model, flags) 配置组合数。 */
  configs: number;
  /** 每个 (config, eval) 组合重复的次数(实验/CLI 的 `--runs`)。 */
  runs: number;
  /** 完整 (label, evalId) 组合清单,按展示顺序排列;不需要调用方预先截断。 */
  rows: readonly AgentPlanRow[];
}

/**
 * `--dry --output agent`(checklist:「输出稳定 PLAN envelope,不运行、不落盘」)。这是一个
 * 独立的纯函数,不经过 `FeedbackRenderer`/coordinator——dry run 根本不派发 attempt,没有
 * 「运行中的反馈状态」可言,调用方(CLI 接线阶段)直接拿 `AgentRun`/`DiscoveredEval` 展开出的
 * 组合表调这个函数即可,不需要先构造一个整装的 coordinator 再假装 start 一次。
 *
 * `rowCap` 默认值(见上面 `AGENT_PLAN_ROW_CAP` 的注释)不是 docs 正文声明的强制数字,调用方
 * 可以按真实场景覆盖。
 */
export function renderAgentPlanEnvelope(input: AgentDryPlanInput, rowCap: number = AGENT_PLAN_ROW_CAP): string {
  const lines = [
    [
      "NICEEVAL PLAN",
      kv("total", input.total),
      kv("evals", input.evals),
      kv("configs", input.configs),
      kv("runs", input.runs),
    ].join(" "),
  ];
  const shown = input.rows.slice(0, Math.max(0, rowCap));
  const labelWidth = shown.reduce((w, r) => Math.max(w, r.label.length), 0);
  for (const row of shown) lines.push(`${row.label.padEnd(labelWidth)}  ${row.evalId}`);
  if (input.rows.length > shown.length) lines.push(`… ${input.rows.length - shown.length} more`);
  return lines.join("\n");
}
