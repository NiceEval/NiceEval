// CI profile renderer(见 docs/feature/experiments/cli.md「CI 怎么用」)。
//
// 目标读者是 CI job 日志和读日志的人/annotation adapter,不是交互终端:
// - 「run:start 之后」的一切正常事件(start/progress/failed/errored/diagnostic/budget_exhausted/
//   interrupted/reporter_error/result/json/junit/snapshots)全部走 `stdout` 一个 sink——不拆到
//   stderr,因为大多数 CI runner 把两个 OS stream 分开缓冲/采集,交错写会打乱真实发生顺序
//   (checklist 第一条)。`stderr` 只保留给 run 尚未建立前的 argv/config 错误,那些错误发生在
//   coordinator/renderer 存在之前,根本不经过这个模块——所以这里没有任何写 `io.stderr` 的分支,
//   不是遗漏。
// - 固定 ASCII `niceeval: <word> key=value ...` 行,字段名是英文字面量,不查 i18n 字典、不读
//   `NICEEVAL_LANG`(checklist 第二条)——这与 human.ts 形成对照:human 走 `t()` 因为它是给人看的,
//   这里每一处文案都是硬编码字符串。
// - `start` 在 "plan" 永久事件到达时同步打印,不需要像 agent.ts 那样等第一次 tick——CI 的 start
//   行只有 `total/configs/concurrency/reused` 四个字段(见 cli.md 字面例子),这些在 "plan" 那一刻
//   全部已知(不像 agent 的 progress 行还带 `running/queued`,那两个要等调度真的把 attempt 派发
//   出去才有意义)。
// - 之后只有 failed/errored/diagnostic 类永久事件立即追加,其余状态变化只在连续 60 秒没有任何
//   永久事件时才追加一条 progress heartbeat(checklist 第三条);任何永久事件(不止 diagnostic,
//   也包括 failure/budget-exhausted/interrupted/reporter-error)都重置这个 60 秒时钟——与
//   agent.ts 对「warning」的理解一致,这里同样用「lastCheckpointAtMs 被 appendDurable 无条件
//   更新」来实现,不单独区分「哪种永久事件才算数」。
// - 不实现 `clearDynamic`/`redrawDynamic`/`activity`/`onLifecycle`:CI 没有动态区域,不展示
//   active phase、不逐次输出 provisioning retry/backoff、不逐条打印 passed attempt——这些目标
//   行为由「不实现对应可选钩子」天然满足(见 renderer.ts 的接口注释),不需要在这里写
//   `if (profile === "ci")` 分支。
//
// 与 human.ts / agent.ts 刻意不共享任何内部函数/类型(哪怕字面意思相同,如 group 推导、
// 转义、verdict 优先级)——三个 renderer 各自独立成立,不应该因为共享一个私有 helper 而在未来
// 被迫同步重构(与 agent.ts 顶部注释同一原则)。
//
// 为什么 errored 的 checkpoint 行不拆 `code=`/`message=`:
//   与 agent.ts 面对的是同一个 `FailureNotice`——执行错误只有一个整句 `reason` 字段,没有独立的
//   `code` 字段；failed assertion 则携带 assertion/matcher/expected/received 等结构化字段。
//   cli.md「CI 怎么用」给出的 `errored` 例子(`code=sandbox-rate-limit message="..."`)和
//   「timeout、budget 与基础设施错误」给出的另一个例子(`kind=timeout timeout_ms=60000`)彼此
//   字段名都不一致,且都要求解析/猜测 `reason` 文案的隐含格式才能拆出来——这正是顶层「不接受」
//   清单禁止的「Agent/CI 解析 human 文案」。这里改为只输出类型里已有的结构化字段
//   (locator/eval/experiment/phase/reason),`reason` 作为整句、不做二次拆分的字段直接输出
//   (与「立即追加」给出的 `failed` 例子一致:那一行确实是把整句塞进 `reason=` 一个字段)。
//
// 为什么 `elapsed=`/`duration=` 统一用「原始秒数,不做分钟换算」:
//   cli.md「CI 怎么用」同一段字面例子里,`elapsed=60s`/`elapsed=120s`(均已过 1 分钟)与
//   `duration=128s`(同样已过 2 分钟)三处全部是原始秒数、不换算成 `Xm YYs`;但另一处独立的
//   budget 例子给出 `duration=18m02s`——同一份文档对「多长该不该换算」自相矛盾(与 Stage D/E
//   已经记录的其它 cli.md 例子内部不一致是同一类问题)。这里选择与「同一个例子块内」三处数字
//   一致的算法(原始秒数),不为了迁就另一个独立例子引入 `Xm YYs` 换算——引入换算会让
//   `elapsed=120s` 变成 `elapsed=2m00s`,反而背离了给出最多字面文本的那个例子。集成测试
//   (ci.test.ts)覆盖 budget-incomplete 场景时按这个算法断言数字,不追求复现 "18m02s" 这个
//   孤立字符串。
//
// 为什么 `DurableFeedbackEvent` 的 "saved" 变体多了 `json`/`junit` 两个字段(见 ../types.ts):
//   cli.md 给出的 result 收尾字面例子是三条独立的行——`json=.../ci-summary.json`、
//   `junit=.../junit.xml`、`snapshots=.../<3 snapshots>`——分别对应「用户显式要的聚合报告是否
//   写出成功」与「快照落盘在哪」两类不同信息。原有 "saved" 事件只有一个扁平 `paths: string[]`,
//   没有字段能让这个 renderer 区分「这条路径是 JSON 报告」还是「这是一个快照目录」,逼得只能靠
//   猜文件后缀反推——这正是要避免的隐式解析。这里改为在 `paths`(继续只表示快照结果路径,
//   human.ts/agent.ts 的既有用法不变)之外新增两个可选字段,只在真的写出对应文件时才有值。
//   `FeedbackCoordinator.finish()` 的入参同步加了这两个可选字段并原样转发——纯新增、不改变
//   任何已有调用点的类型检查(human/agent 的测试与实现都不读这两个新字段)。

import type { FeedbackRenderer } from "./renderer.ts";
import type { FeedbackIO } from "./io.ts";
import type { DurableFeedbackEvent, RunCompletion, RunFeedbackState, RunSummary } from "../types.ts";

/** failed/errored 立即展开上限(cli.md「'立即追加'也必须有上限」表:ci 前 50 条;完整清单
 *  由 JSON/JUnit 保存,checklist 第四条)。 */
const CI_FAILURE_CAP = 50;
/** 连续无永久事件多久才追加一条 progress heartbeat(checklist 第三条:「连续 60 秒无永久事件
 *  才 heartbeat」)。 */
const CI_HEARTBEAT_IDLE_MS = 60_000;

export interface CiRendererOptions {
  io: FeedbackIO;
}

/**
 * 创建 ci profile 的 `FeedbackRenderer`。只用 `io.stdout` 写文本——checklist 第一条要求
 * 「CI 正常事件全部走一个 stdout sink」,这个模块里没有任何 `io.stderr.write` 调用,不是遗漏。
 */
export function createCiRenderer(options: CiRendererOptions): FeedbackRenderer {
  const { io } = options;

  // 距上一次「有意义的输出」(任意一次永久事件)过了多久,用来判断要不要追加一条 heartbeat。
  // "plan" 本身就是第一次永久事件,天然把这个时钟从 0 开始计——不需要像 agent.ts 那样为
  // 「start 行需要真实调度后的 running/queued」而单独等第一次 tick(见文件顶部注释)。
  let lastCheckpointAtMs = 0;
  // "summary" 与 "saved" 是 coordinator.finish() 里连续 emit 的两个独立永久事件(见
  // coordinator.ts 的 finish() 实现,中间不会插入其它事件)——result 收尾需要两者合并,所以
  // "summary" 到达时先记下来,"saved" 到达时才真正写出 result/json/junit/snapshots 几行。
  let pendingSummary: { summary: RunSummary; completion: RunCompletion; reused: number } | undefined;

  function noteCheckpoint(atMs: number): void {
    lastCheckpointAtMs = atMs;
  }

  return {
    appendDurable(event, state) {
      switch (event.type) {
        case "plan": {
          noteCheckpoint(event.at);
          const { shape, reused } = event.plan;
          io.stdout.write(
            `niceeval: start ${kv("total", shape.totalRuns)} ${kv("configs", shape.configs)} ${kv(
              "concurrency",
              shape.maxConcurrency,
            )} ${kv("reused", reused)}\n`,
          );
          return;
        }

        case "failure": {
          noteCheckpoint(event.at);
          writeFailureCheckpoint(io, event, state.freshFailureCount);
          return;
        }

        case "diagnostic": {
          noteCheckpoint(event.at);
          if (!isFirstOccurrence(state, event.key)) return; // 去重后只追加一次(checklist)
          const parts = [`niceeval: ${event.severity === "error" ? "error" : "warning"}`, kv("key", event.key)];
          if (event.identity?.evalId) parts.push(kv("eval", event.identity.evalId));
          if (event.identity?.experimentId) parts.push(kv("experiment", event.identity.experimentId));
          parts.push(kv("message", event.message));
          io.stdout.write(parts.join(" ") + "\n");
          return;
        }

        case "budget-exhausted": {
          noteCheckpoint(event.at);
          if (!isFirstOccurrence(state, `budget-exhausted:${event.experimentId}`)) return;
          io.stdout.write(
            `niceeval: budget_exhausted ${kv("experiment", event.experimentId)} ${kv(
              "spent",
              event.spent.toFixed(2),
            )} ${kv("unstarted", event.unstarted)}\n`,
          );
          return;
        }

        case "experiment-hook": {
          // 实验级钩子起止各一行(见 cli.md「实验级钩子的显示」):CI 日志没有动态区域,
          // 长 setup 期间只有 heartbeat 无法区分「钩子在跑」和「挂死」。
          noteCheckpoint(event.at);
          const word = event.hook === "setup" ? "experiment_setup" : "experiment_teardown";
          const parts = [`niceeval: ${word}`, kv("experiment", event.experimentId), kv("status", event.status)];
          if (event.durationMs !== undefined) parts.push(kv("duration", formatCiSeconds(event.durationMs)));
          io.stdout.write(parts.join(" ") + "\n");
          return;
        }

        case "interrupted": {
          noteCheckpoint(event.at);
          if (!isFirstOccurrence(state, "interrupted")) return;
          io.stdout.write(`niceeval: interrupted ${kv("elapsed", formatCiSeconds(state.elapsedMs))}\n`);
          return;
        }

        case "reporter-error": {
          noteCheckpoint(event.at);
          if (!isFirstOccurrence(state, `reporter-error:${event.reporter}`)) return;
          io.stdout.write(
            `niceeval: reporter_error ${kv("reporter", event.reporter)} ${kv("required", event.required)} ${kv(
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
          // 人读单行(见 docs/feature/sandbox/cli.md「run 收尾输出」的 ci 形态)。
          io.stderr.write(
            `niceeval: kept sandbox ${event.sandboxId} (${event.provider}) — ${event.identity.evalId} #${event.identity.attempt} ${event.verdict} — enter: niceeval sandbox enter ${event.sandboxId.slice(0, 12)}\n`,
          );
          return;

        case "saved":
          writeResultBlock(io, pendingSummary, event);
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
      if (idle < CI_HEARTBEAT_IDLE_MS) return;
      noteCheckpoint(event.at);
      io.stdout.write(progressLine(state, event.elapsedMs) + "\n");
    },

    // 没有 clearDynamic/redrawDynamic/activity/onLifecycle:见文件顶部注释——CI 不维护动态
    // 区域、不逐次输出 provisioning retry/backoff、不逐条展示 active phase 或 passed attempt,
    // 这些由「不实现对应可选钩子」天然满足。
  };
}

/** 某个去重 key 在 `state.diagnostics` 里是不是第一次出现(count === 1)。budget-exhausted /
 *  interrupted / reporter-error 的去重 key 计算方式与 reducer.ts 完全一致(见该文件的
 *  `budget-exhausted:${experimentId}` / `"interrupted"` / `reporter-error:${reporter}`),
 *  两处必须同源,不能各写一份——与 agent.ts 同一原则(这几个 key 是 `DurableFeedbackEvent`
 *  自身语义的一部分,不是 reducer 实现细节,三个 renderer 都要各自能算出同一个 key)。 */
function isFirstOccurrence(state: RunFeedbackState, key: string): boolean {
  return (state.diagnostics.find((d) => d.key === key)?.count ?? 0) <= 1;
}

// ───────────────────────── 字段转义 / envelope 拼装(纯函数) ─────────────────────────

type FieldValue = string | number | boolean;

/** 字段值需要空格(或引号)时用 JSON string 转义,不依赖 locale(与 agent.ts 同一规则,独立
 *  实现)。没有空格/引号的值保持裸 token。 */
function escapeFieldValue(raw: string): string {
  return /[\s"]/.test(raw) ? JSON.stringify(raw) : raw;
}

function kv(key: string, value: FieldValue): string {
  return typeof value === "string" ? `${key}=${escapeFieldValue(value)}` : `${key}=${value}`;
}

/** "0s" / "60s" / "128s" 风格,不做分钟换算——见文件顶部「为什么统一用原始秒数」。 */
function formatCiSeconds(ms: number): string {
  return `${Math.max(0, Math.floor(ms / 1000))}s`;
}

function progressLine(state: RunFeedbackState, elapsedMs: number): string {
  return [
    "niceeval: progress",
    kv("elapsed", formatCiSeconds(elapsedMs)),
    kv("reused", state.reused),
    kv("running", state.running),
    kv("queued", state.queued),
    kv("completed", state.completed),
  ].join(" ");
}

// ───────────────────────── failure / error checkpoint(stdout,立即追加,带上限) ─────────────────────────

function writeFailureCheckpoint(io: FeedbackIO, event: DurableFeedbackEvent & { type: "failure" }, countSoFar: number): void {
  if (countSoFar === CI_FAILURE_CAP + 1) {
    // 越过上限的第一条给一次 suppressed 提示,不是每条失败都重复一遍——完整清单由 JSON/JUnit
    // 保存(checklist 第四条),这里只保证「知道发生了折叠」。必须在下面的「> CAP 一律静默」
    // 之前判断,否则这个分支永远不可达。
    io.stdout.write(
      `niceeval: warning ${kv("key", "failures-suppressed")} ${kv(
        "message",
        "further failed/errored attempts are not streamed individually; see the JSON/JUnit report",
      )}\n`,
    );
    return;
  }
  if (countSoFar > CI_FAILURE_CAP) return; // 上限之后完全静默
  const word = event.verdict === "errored" ? "errored" : "failed";
  const parts = [`niceeval: ${word}`, kv("locator", event.locator), kv("eval", event.identity.evalId)];
  if (event.identity.experimentId) parts.push(kv("experiment", event.identity.experimentId));
  if (event.phase) parts.push(kv("phase", event.phase));
  if (event.assertion) {
    parts.push(kv("severity", event.assertion.severity), kv("assertion", event.assertion.assertion));
    if (event.assertion.matcher !== undefined) parts.push(kv("matcher", event.assertion.matcher));
    if (event.assertion.expected !== undefined) parts.push(kv("expected", event.assertion.expected));
    if (event.assertion.received !== undefined) parts.push(kv("received", event.assertion.received));
    if (event.assertion.score !== undefined) parts.push(kv("score", event.assertion.score));
    if (event.assertion.threshold !== undefined) parts.push(kv("threshold", event.assertion.threshold));
    if (event.assertion.reason !== undefined) parts.push(kv("reason", event.assertion.reason));
    if (event.assertion.additionalFailures > 0) parts.push(kv("additional_failures", event.assertion.additionalFailures));
  } else {
    parts.push(kv("reason", event.reason));
  }
  io.stdout.write(parts.join(" ") + "\n");
}

// ───────────────────────── result 收尾(stdout,status/counts/reused/unstarted/duration + json/junit/snapshots) ─────────────────────────

/** completion 优先于 verdict 计数——interrupted/incomplete 时即便全部 attempt 都通过,也不能
 *  说 "passed"(checklist 第六条:budget unstarted → incomplete、用户中断 → interrupted)。
 *  required reporter 失败同样折进 "failed":它不是 `CompletionStatus` 的第四个值(那个枚举
 *  只有 complete/incomplete/interrupted 三态,见 ../types.ts 的 `CompletionStatus` 注释),
 *  但「要求的 reporter 写失败」必须让退出码非零(见 `computeCiExitCode`),状态词也不能显示
 *  一个会被误读成「全绿」的 "passed"。 */
function resultStatusWord(summary: RunSummary, completion: RunCompletion): "passed" | "failed" | "incomplete" | "interrupted" {
  if (completion.status === "interrupted") return "interrupted";
  if (completion.status === "incomplete") return "incomplete";
  if (completion.reporterErrors.some((e) => e.required)) return "failed";
  return summary.failed > 0 || summary.errored > 0 ? "failed" : "passed";
}

function resultLine(summary: RunSummary, completion: RunCompletion, reused: number): string {
  const parts = [
    `niceeval: result=${resultStatusWord(summary, completion)}`,
    kv("passed", summary.passed),
    kv("failed", summary.failed),
    kv("errored", summary.errored),
  ];
  // reused/unstarted 都只在 > 0 时才出现——与 cli.md 的两个字面例子完全对应:正常例子有
  // `reused=18`(无 unstarted),budget 例子有 `unstarted=4`(无 reused)。两个字段互不排斥,
  // 理论上可以同时出现(既有携入结果、又有 budget 未派发),这里的条件判断天然支持这种情况。
  if (reused > 0) parts.push(kv("reused", reused));
  if (completion.unstarted > 0) parts.push(kv("unstarted", completion.unstarted));
  parts.push(kv("duration", formatCiSeconds(summary.durationMs)));
  return parts.join(" ");
}

/** 快照路径的共同「组」段(如 `.niceeval/ci/bub/<snapshot>` → `ci`),用于折叠成
 *  `.niceeval/<group>/<N snapshots>`。多个 experiment 组混在一次 invocation 里时组名不唯一,
 *  不猜一个可能错的前缀,退化成不带路径前缀的 `<N snapshots>`——与 human.ts/agent.ts 同名逻辑
 *  刻意分开实现(见文件顶部注释),不是共享同一个函数。 */
function deriveResultGroup(paths: readonly string[]): string | undefined {
  const groups = new Set<string>();
  for (const p of paths) {
    const seg = p.split("/")[1];
    if (seg) groups.add(seg);
  }
  return groups.size === 1 ? [...groups][0] : undefined;
}

/** 单条路径直接原样打印;多条折叠成 `<N snapshots>`(见 cli.md「CI 怎么用」的字面例子:
 *  `.niceeval/ci/<3 snapshots>`)——CI「同一种事件一行」的整体约束(checklist/docs 都强调
 *  一行一事件,方便日志搜索)决定了这里不能像 human/agent 那样逐条缩进列出。 */
function snapshotsValue(paths: readonly string[]): string {
  if (paths.length === 1) return paths[0]!;
  const group = deriveResultGroup(paths);
  return group ? `.niceeval/${group}/<${paths.length} snapshots>` : `<${paths.length} snapshots>`;
}

function writeResultBlock(
  io: FeedbackIO,
  pending: { summary: RunSummary; completion: RunCompletion; reused: number } | undefined,
  event: DurableFeedbackEvent & { type: "saved" },
): void {
  if (!pending) return; // 不应发生:coordinator.finish() 恒先 emit "summary" 再 emit "saved"。
  const { summary, completion, reused } = pending;
  io.stdout.write(resultLine(summary, completion, reused) + "\n");
  // json=/junit=/snapshots= 各自独立一行,且只在真的写出对应产物时才打印(checklist 第五条:
  // 「随后打印实际生成的 JSON/JUnit/快照路径」——"实际生成的",不是"配置里要求生成的")。
  if (event.json) io.stdout.write(`niceeval: json=${event.json}\n`);
  if (event.junit) io.stdout.write(`niceeval: junit=${event.junit}\n`);
  if (event.paths.length > 0) io.stdout.write(`niceeval: snapshots=${snapshotsValue(event.paths)}\n`);
}

// ───────────────────────── 退出码(CompletionStatus 驱动,checklist 第六条) ─────────────────────────

/**
 * 把 `RunSummary` + `RunCompletion` 折成 CLI 退出码——checklist:「budget unstarted →
 * incomplete + 非零；required reporter 失败 → 非零；用户中断 → 130」。这是这个 stage 承担的
 * 「CompletionStatus 驱动的退出码语义」交付物(见 docs/feature/experiments/cli.md「CI 怎么用」
 * 的退出码表):不看 CLI flag、不读 process.env,是纯函数,后续 CLI 接线阶段(plan section G)
 * 直接调用它算最终 `process.exit()` 的参数,不需要在 `src/cli.ts` 里重新写一遍这套判断
 * (今天 `src/cli.ts` 的 `evalLevelStats`/`failedExit` 只看 failed/errored,不知道
 * incomplete/interrupted/reporter 失败这三类——接线时用这个函数的结果替换那段逻辑,而不是
 * 在旁边再加一层判断)。这个函数不是"仅 --output ci 才用"——退出码是进程级机器信号,与选了
 * 哪个反馈 profile 无关,human/agent 跑同一次 run 得到的退出码必须一致;放在这个模块只是因为
 * CI 是最早、最明确需要 CompletionStatus 三态参与退出码判断的消费者。
 *
 * 不在这里处理「2 = CLI/runner 未捕获崩溃」——那是进程级 uncaught exception/rejection 处理器
 * 的职责,不是「一次 run 正常收尾后该给什么退出码」的问题,不应该由 completion 驱动。
 */
export function computeCiExitCode(summary: RunSummary, completion: RunCompletion): number {
  if (completion.status === "interrupted") return 130;
  if (completion.status === "incomplete") return 1;
  if (completion.reporterErrors.some((e) => e.required)) return 1;
  return summary.failed > 0 || summary.errored > 0 ? 1 : 0;
}

// ───────────────────────── `--dry`(ci profile):稳定预览,不经 coordinator ─────────────────────────

/** 一个 (config, eval) 组合在 `--dry` 预览里的一行。与 human.ts 的 `HumanDryPlanRow` 字段形状
 *  相似但刻意分开定义(见文件顶部「不共享」注释)——ci 用 `experimentId ?? who` 拼出单一
 *  `experiment=` 字段,不像 human 那样分成 `who` + `experimentSuffix` 两段拼接文案。 */
export interface CiDryPlanRow {
  experimentId?: string;
  who: string;
  evalIds: readonly string[];
  runs: number;
}

export interface CiDryPlanInput {
  /** 总 attempt 数(= Σ 每个 (config, eval) 组合的 evalIds.length × runs)。 */
  total: number;
  /** 去重后候选 eval 数,口径同 `RunFeedbackPlan.shape.evals`。 */
  evals: number;
  configs: number;
  rows: readonly CiDryPlanRow[];
}

/** dry run 不派发 attempt,没有 `RunFeedbackState` 可言,所以这是独立于 `FeedbackRenderer`/
 *  coordinator 的纯函数(与 `computeCiExitCode`、agent.ts 的 `renderAgentPlanEnvelope` 同一定位)。
 *  仍然是固定 ASCII `niceeval: <word> key=value` 行,不读 i18n、不设行数上限——预览的组合数
 *  就是这次调用会展开的完整矩阵,不是运行中可能无界增长的事件流,没有「防止刷屏」的顾虑。 */
export function renderCiDryPlan(input: CiDryPlanInput): string {
  const lines = [
    `niceeval: plan ${kv("total", input.total)} ${kv("evals", input.evals)} ${kv("configs", input.configs)}`,
  ];
  for (const row of input.rows) {
    lines.push(
      `niceeval: plan-row ${kv("experiment", row.experimentId ?? row.who)} ${kv(
        "evals",
        row.evalIds.join(", ") || "(no matches)",
      )} ${kv("runs", row.runs)}`,
    );
  }
  return lines.join("\n") + "\n";
}
