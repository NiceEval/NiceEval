// cases: docs/engineering/testing/unit/reports.md
// 「show 终端宿主的选择、时间轴与文案」行:紧凑索引行的判定原因(verdictReasonLine)对多行
// `error.message` 折首行并剥控制字节收口——diagnose 从第二行起的 output tail 不进单行面,
// 完整多行 message 归 attempt 详情块展开。
// bug: memory/diagnose-tail-inline-defeats-one-line-elision.md
//
// 「execution 的预算、句柄与 grep」(docs/engineering/testing/unit/reports.md):卡片预览预算按段
// 独立截断——每段最多显示前 3 行(骨架行不计入),每段另有 1 KiB 字节兜底(按字符边界回退);
// 卡尾聚合全卡各段被折的行数与字符数,没有整行被折时行数退化省略;Agent 卡的 t<N>.c<M> 从事件序
// 确定性派生,失败 Sandbox 命令卡的 cmd<N> 按 timing node 时序派生;--expand 命中还原完整落盘值、
// 句柄超界的完整报错;--grep 的匹配面覆盖角色文本、工具名、input、result 与失败命令
// display/stdout/stderr;命中计数与 0 命中的明确输出。

import { describe, expect, it } from "vitest";
import { executionText, verdictReasonLine } from "./render.ts";
import type { EvalResult, PhaseTiming, StreamEvent, TimingNode, Verdict } from "../types.ts";
import { buildExecutionTree } from "../o11y/execution-tree.ts";
import { encodeAttemptLocator, type AttemptEvidence, type AttemptIdentity } from "../results/index.ts";

function erroredResult(message: string): EvalResult {
  return {
    id: "react-datepicker/pr-6168",
    agent: "bub",
    verdict: "errored",
    attempt: 0,
    durationMs: 1,
    assertions: [],
    error: { code: "turn-failed", message, phase: "eval.run" },
  };
}

describe("verdictReasonLine 的 errored 单行收口", () => {
  it("多行 message 只取首行,tail 的框线不进紧凑索引行", () => {
    const line = verdictReasonLine(
      erroredResult("agent run exited with code 1 · last error: rate limited\noutput tail:\n│ ❱ 205 │ raise APIError("),
    );
    expect(line).toBe("agent run exited with code 1 · last error: rate limited");
    expect(line).not.toContain("│");
  });

  it("单行 message 原样保留", () => {
    expect(verdictReasonLine(erroredResult("sandbox allocation failed"))).toBe("sandbox allocation failed");
  });
});

// ───────────────────────── fixture:AttemptEvidence + 手工 timing 树 ─────────────────────────

function identityOf(overrides: Partial<AttemptIdentity> = {}): AttemptIdentity {
  return { experimentId: "exp/a", snapshotStartedAt: "2026-07-01T00:00:00.000Z", evalId: "eval/one", attempt: 0, ...overrides };
}

function resultOf(overrides: Partial<EvalResult> = {}): EvalResult {
  return {
    id: "eval/one",
    agent: "agent-x",
    verdict: "passed" as Verdict,
    attempt: 0,
    durationMs: 1000,
    assertions: [],
    ...overrides,
  };
}

function evidenceOf(overrides: Partial<AttemptEvidence> = {}): AttemptEvidence {
  const identity = overrides.identity ?? identityOf();
  return {
    locator: overrides.locator ?? encodeAttemptLocator(identity),
    identity,
    result: overrides.result ?? resultOf(),
    events: overrides.events ?? null,
    evalSource: overrides.evalSource ?? null,
    execution: overrides.execution ?? null,
    diff: overrides.diff ?? null,
    trace: overrides.trace ?? null,
    commands: overrides.commands ?? null,
    artifactPaths: overrides.artifactPaths ?? { dir: "/results/exp/a/eval-one/a0" },
    capabilities: overrides.capabilities ?? { source: false, execution: true, timing: false, diff: false },
  };
}

/** 两轮对话:t1 有 USER/ASSISTANT/TOOL 三张卡,t2 有 USER/ASSISTANT 两张卡。 */
function twoTurnEvents(): StreamEvent[] {
  return [
    { type: "message", role: "user", text: "Please fix the bug" },
    { type: "message", role: "assistant", text: "Looking into it" },
    { type: "action.called", callId: "call-1", name: "shell", input: { command: "ls" } },
    { type: "action.result", callId: "call-1", output: { output: "file.txt", exit_code: 0 }, status: "completed" },
    { type: "message", role: "user", text: "thanks" },
    { type: "message", role: "assistant", text: "done" },
  ];
}

function twoTurnPhases(): PhaseTiming[] {
  return [
    {
      name: "eval.run" as PhaseTiming["name"],
      durationMs: 2000,
      children: [
        { id: "turn-1", kind: "turn", label: "s1/t1", startOffsetMs: 0, durationMs: 1200 },
        { id: "turn-2", kind: "turn", label: "s1/t2", startOffsetMs: 1200, durationMs: 800 },
      ],
    },
  ];
}

// 全部 fixture 共用同一个 identityOf() 默认值,locator 因此确定性地恒等于这个值——直接用真实
// encodeAttemptLocator 算出来,而不是手写一个和 evidence.locator 对不上的假 "@abc123"
// (--expand/--grep 的定位行、展开句柄里的 locator 都读 evidence.locator,不是 opts.header)。
const LOCATOR = encodeAttemptLocator(identityOf());
const OPTS = { header: `${LOCATOR} · eval/one · exp/a · passed`, width: 100 };

describe("--execution:轮内卡片句柄 t<N>.c<M> 从事件序确定性派生", () => {
  it("同一份 events 两次装配得到相同的句柄/内容(--expand 定位到同一张卡)", () => {
    const events = twoTurnEvents();
    const evidence = evidenceOf({ execution: buildExecutionTree(events, []), result: resultOf({ phases: twoTurnPhases() }) });

    const first = executionText(evidence, OPTS, { expand: "t1.c3" });
    const second = executionText(evidence, OPTS, { expand: "t1.c3" });
    expect(first).toEqual(second);
    expect(first.text).toContain("TOOL · shell");
    // input.command 是字符串时直接显示命令本身,不是再包一层 JSON(与 shell 命令卡同一惯例)。
    expect(first.text).toContain("ls");
    expect(first.text).toContain("file.txt");
  });

  it("t1.c1/c2 分别落在 USER/ASSISTANT,t2.c1/c2 是第二轮的 USER/ASSISTANT——轮边界按用户消息切", () => {
    const events = twoTurnEvents();
    const evidence = evidenceOf({ execution: buildExecutionTree(events, []), result: resultOf({ phases: twoTurnPhases() }) });

    expect(executionText(evidence, OPTS, { expand: "t1.c1" }).text).toContain("Please fix the bug");
    expect(executionText(evidence, OPTS, { expand: "t1.c2" }).text).toContain("Looking into it");
    expect(executionText(evidence, OPTS, { expand: "t2.c1" }).text).toContain("thanks");
    expect(executionText(evidence, OPTS, { expand: "t2.c2" }).text).toContain("done");
  });

  it("turn 头行带标签、status、墙钟", () => {
    const events = twoTurnEvents();
    const evidence = evidenceOf({ execution: buildExecutionTree(events, []), result: resultOf({ phases: twoTurnPhases() }) });
    const { text } = executionText(evidence, OPTS);
    expect(text).toContain("s1/t1 · completed · 1.2s");
    expect(text).toContain("s1/t2 · completed · 800ms");
  });

  it("turn 头行有 usage 时带 token/成本(usage 有记录才出现;TimingNode.usage 是该轮 Turn.usage 落盘原样)", () => {
    const turnWithUsage: TimingNode = {
      id: "turn-1",
      kind: "turn",
      label: "s1/t1",
      startOffsetMs: 0,
      durationMs: 1200,
      usage: { inputTokens: 2000, outputTokens: 10400, costUSD: 0.02 },
    };
    const phases: PhaseTiming[] = [
      {
        name: "eval.run" as PhaseTiming["name"],
        durationMs: 2000,
        children: [turnWithUsage, { id: "turn-2", kind: "turn", label: "s1/t2", startOffsetMs: 1200, durationMs: 800 }],
      },
    ];
    const evidence = evidenceOf({ execution: buildExecutionTree(twoTurnEvents(), []), result: resultOf({ phases }) });
    const { text } = executionText(evidence, OPTS);
    expect(text).toContain("s1/t1 · completed · 1.2s · 12.4k tok · $0.02");
    // 第二轮没有 usage,这一段整体省略,不是显示 0。
    expect(text).toContain("s1/t2 · completed · 800ms\n");
  });
});

describe("--execution:单段卡按 3 行截断,骨架行不计入,尾巴 `(+N lines · M chars · …)`", () => {
  function fiveLineEvidence(): AttemptEvidence {
    // 5 行,前 3 行("alpha"/"bravo"/"charlie")在预算内,后 2 行("delta"/"echo")被整行折掉。
    const events: StreamEvent[] = [
      { type: "message", role: "user", text: "start" },
      { type: "thinking", text: "alpha\nbravo\ncharlie\ndelta\necho" },
    ];
    return evidenceOf({ execution: buildExecutionTree(events, []), result: resultOf({ phases: twoTurnPhases() }) });
  }

  it("只显示前 3 行(保留原始换行),第 4/5 行整行折掉,尾巴报被折行数与字符数", () => {
    const evidence = fiveLineEvidence();
    const { text } = executionText(evidence, OPTS);
    expect(text).toContain("alpha\n    bravo\n    charlie");
    expect(text).not.toContain("delta");
    expect(text).not.toContain("echo");
    // "\ndelta\necho" 相对 "alpha\nbravo\ncharlie" 前缀被折掉的字符(含分隔行首的 \n)。
    expect(text).toContain(`(+2 lines · 11 chars · niceeval show ${LOCATOR} --execution --expand t1.c2)`);
  });

  it("--expand 还原完整未截断内容,不带尾巴", () => {
    const evidence = fiveLineEvidence();
    const { text } = executionText(evidence, OPTS, { expand: "t1.c2" });
    // --expand 走 renderExpand,不经 renderFull 的额外一层 turn 缩进,只剩 renderCardLines 自身
    // 的基础缩进(2 空格),比预览路径(4 空格)少一层。
    expect(text).toContain("alpha\n  bravo\n  charlie\n  delta\n  echo");
    expect(text).not.toContain("niceeval show");
  });
});

describe("--execution:TOOL 卡 input/result 各自独立按 3 行截断,尾巴聚合两段", () => {
  function toolCardEvidence(): AttemptEvidence {
    const events: StreamEvent[] = [
      { type: "message", role: "user", text: "start" },
      { type: "action.called", callId: "call-1", name: "shell", input: { command: "cmd1\ncmd2\ncmd3\ncmd4" } },
      {
        type: "action.result",
        callId: "call-1",
        output: { output: "out1\nout2\nout3\nout4\nout5", exit_code: 0 },
        status: "completed",
      },
    ];
    return evidenceOf({ execution: buildExecutionTree(events, []), result: resultOf({ phases: twoTurnPhases() }) });
  }

  it("input(4 行折 1 行)与 result(5 行折 2 行)各自独立截断,骨架行`input`/`result · <status>`原样全显", () => {
    const evidence = toolCardEvidence();
    const { text } = executionText(evidence, OPTS);
    expect(text).toContain("input");
    expect(text).toContain("result · completed · exit 0");
    expect(text).toContain("cmd1");
    expect(text).toContain("cmd2");
    expect(text).toContain("cmd3");
    expect(text).not.toContain("cmd4");
    expect(text).toContain("out1");
    expect(text).toContain("out2");
    expect(text).toContain("out3");
    expect(text).not.toContain("out4");
    expect(text).not.toContain("out5");
  });

  it("卡尾只有一条,聚合两段各自被折的行数(1+2=3)与字符数(5+10=15)", () => {
    const evidence = toolCardEvidence();
    const { text } = executionText(evidence, OPTS);
    expect(text).toContain(`(+3 lines · 15 chars · niceeval show ${LOCATOR} --execution --expand t1.c2)`);
    // 每卡只出现一次尾巴,不是 input/result 各带一条。
    expect(text.match(/niceeval show .* --expand/g)?.length).toBe(1);
  });

  it("--expand 还原两段完整内容,不截断", () => {
    const evidence = toolCardEvidence();
    const { text } = executionText(evidence, OPTS, { expand: "t1.c2" });
    expect(text).toContain("cmd4");
    expect(text).toContain("out5");
    expect(text).not.toContain("niceeval show");
  });
});

describe("--execution:1 KiB 字节兜底(按字符边界回退,不切分代理对),没有整行被折时 N 退化省略", () => {
  function bigSingleLineEvidence(): AttemptEvidence {
    // 单行(不触发 3 行上限)但 1022 ascii(1B) + 3 emoji(4B) = 1034B > 1024B 段预算。
    const bigText = "x".repeat(1022) + "🙂".repeat(3);
    const events: StreamEvent[] = [
      { type: "message", role: "user", text: "start" },
      { type: "thinking", text: bigText },
    ];
    return evidenceOf({ execution: buildExecutionTree(events, []), result: resultOf({ phases: twoTurnPhases() }) });
  }

  it("超预算截到恰好塞满 1024 字节的 codepoint 边界,没有整行被折,尾巴退化为 `(+M chars · …)`(没有 `lines` 段)", () => {
    const evidence = bigSingleLineEvidence();
    const { text } = executionText(evidence, OPTS);
    // 1022 个 ascii "x" 用尽预算内的 1022 字节,下一枚 emoji(4B)放不进剩余 2 字节,整枚被折掉。
    // 用最长连续 x 串而不是全文 x 计数——尾巴里的 "--execution"/"--expand" 与 header 的 "exp/a"
    // 本身也含 'x' 字母,全文计数会被这些无关 'x' 污染。
    const longestXRun = Math.max(0, ...[...text.matchAll(/x+/g)].map((m) => m[0].length));
    expect(longestXRun).toBe(1022);
    expect(text).not.toContain("🙂");
    expect(text).toContain(`(+3 chars · niceeval show ${LOCATOR} --execution --expand t1.c2)`);
    expect(text).not.toContain("lines ·");
  });

  it("--expand 还原完整未截断内容(原始换行,不再截断)", () => {
    const evidence = bigSingleLineEvidence();
    const { text } = executionText(evidence, OPTS, { expand: "t1.c2" });
    expect(text).toContain("🙂🙂🙂");
    expect(text).not.toContain("niceeval show");
    const longestXRun = Math.max(0, ...[...text.matchAll(/x+/g)].map((m) => m[0].length));
    expect(longestXRun).toBe(1022);
  });

  it("被字节兜底截到一半的行,如果全卡还有整行被折,计入被折行数(不退化)", () => {
    // 4 行:前 2 行短,第 3 行(2000 个 'x')把候选(3 行)的字节数撑到 1024 以上触发字节兜底,
    // 第 4 行("hiddenLine")完全在 3 行上限之外被整行折掉——两种折法同一张卡都发生。
    const events: StreamEvent[] = [
      { type: "message", role: "user", text: "start" },
      { type: "thinking", text: `short1\nshort2\n${"x".repeat(2000)}\nhiddenLine` },
    ];
    const evidence = evidenceOf({ execution: buildExecutionTree(events, []), result: resultOf({ phases: twoTurnPhases() }) });
    const { text } = executionText(evidence, OPTS);
    expect(text).toContain("short1");
    expect(text).toContain("short2");
    expect(text).not.toContain("hiddenLine");
    const longestXRun = Math.max(0, ...[...text.matchAll(/x+/g)].map((m) => m[0].length));
    expect(longestXRun).toBe(1010); // 1024 字节预算 - "short1\nshort2\n"(14 字节) = 1010 个 x
    // N = 1(hiddenLine 整行被折) + 1(第 3 行被字节兜底截到一半,全卡有整行被折时计入) = 2。
    expect(text).toContain(`(+2 lines · 1001 chars · niceeval show ${LOCATOR} --execution --expand t1.c2)`);
  });
});

describe("--execution:落盘已截断的值原样透传", () => {
  it("marker 是写入时刻烘进正文的字面文本,在预览与 --expand 中都原样透传(短文本,预算内不截断)", () => {
    const diskTruncated = "partial output before cut\n[niceeval] truncated 51467156 → 262144 bytes";
    const events: StreamEvent[] = [
      { type: "message", role: "user", text: "start" },
      { type: "thinking", text: diskTruncated },
    ];
    const evidence = evidenceOf({ execution: buildExecutionTree(events, []) });
    expect(executionText(evidence, OPTS).text).toContain("[niceeval] truncated 51467156 → 262144 bytes");
    expect(executionText(evidence, OPTS, { expand: "t1.c2" }).text).toContain("[niceeval] truncated 51467156 → 262144 bytes");
  });
});

describe("--expand:句柄未命中报实际 turn/卡片数,不猜相邻卡片", () => {
  it("turn 序号超界:报该 attempt 实际 turn 数", () => {
    const evidence = evidenceOf({ execution: buildExecutionTree(twoTurnEvents(), []), result: resultOf({ phases: twoTurnPhases() }) });
    expect(() => executionText(evidence, OPTS, { expand: "t5.c1" })).toThrow(/this attempt has 2 turns/);
  });

  it("turn 存在但卡片序号超界:报该 turn 实际卡片数", () => {
    const evidence = evidenceOf({ execution: buildExecutionTree(twoTurnEvents(), []), result: resultOf({ phases: twoTurnPhases() }) });
    expect(() => executionText(evidence, OPTS, { expand: "t1.c9" })).toThrow(/turn 1 has 3 cards/);
  });

  it("命令序号超界:报该 attempt 实际失败命令数", () => {
    const evidence = evidenceOf({ execution: buildExecutionTree(twoTurnEvents(), []), result: resultOf({ phases: twoTurnPhases() }) });
    expect(() => executionText(evidence, OPTS, { expand: "cmd1" })).toThrow(/this attempt has 0 failed commands/);
  });

  it("语法不认识的句柄报完整用法错误", () => {
    const evidence = evidenceOf({ execution: buildExecutionTree(twoTurnEvents(), []), result: resultOf({ phases: twoTurnPhases() }) });
    expect(() => executionText(evidence, OPTS, { expand: "bogus" })).toThrow(/invalid handle "bogus"/);
  });
});

describe("--execution:失败 Sandbox 命令卡 cmd<N> 按 timing node 时序派生", () => {
  function commandsEvidence(): AttemptEvidence {
    const phases: PhaseTiming[] = [
      {
        name: "eval.setup" as PhaseTiming["name"],
        durationMs: 500,
        children: [
          { id: "cmd-node-b", kind: "command", label: "npm", startOffsetMs: 300, durationMs: 100, command: { display: "npm ci", exitCode: 1 } },
          { id: "cmd-node-a", kind: "command", label: "git", startOffsetMs: 10, durationMs: 20, command: { display: "git fetch", exitCode: 128 } },
        ],
      },
    ];
    return evidenceOf({
      execution: null,
      result: resultOf({ phases }),
      commands: [
        { timingNodeId: "cmd-node-b", phase: "eval.setup", display: "npm ci", exitCode: 1, stdout: "", stderr: "npm error EACCES" },
        { timingNodeId: "cmd-node-a", phase: "eval.setup", display: "git fetch", exitCode: 128, stdout: "", stderr: "fatal: could not read" },
      ],
    });
  }

  it("按关联 timing 节点的 startOffsetMs 排序编号(不是 commands.json 里的原始数组顺序)", () => {
    const evidence = commandsEvidence();
    // cmd-node-a 的 startOffsetMs=10 早于 cmd-node-b 的 300,即使它在 commands 数组里排第二,也应是 cmd1。
    expect(executionText(evidence, OPTS, { expand: "cmd1" }).text).toContain("git fetch");
    expect(executionText(evidence, OPTS, { expand: "cmd2" }).text).toContain("npm ci");
  });

  it("命令卡标题带关联 phase 与 timing 节点 duration,正文分 stdout/stderr(空字段整段省略)", () => {
    const evidence = commandsEvidence();
    const { text } = executionText(evidence, OPTS);
    expect(text).toContain("FAILED COMMAND · eval.setup · exit 128 · 20ms");
    expect(text).toContain("fatal: could not read");
    expect(text).not.toMatch(/stdout\n/); // 两条命令 stdout 都是空串,不出现空 stdout 区块
  });

  it("没有 events 但有失败命令时仍渲染命令卡,不因为 execution 树为空就整段零输出", () => {
    const evidence = commandsEvidence();
    const { text } = executionText(evidence, OPTS);
    expect(text).toContain("FAILED COMMAND");
    expect(text).not.toContain("no events recorded");
  });

  it("没有失败命令(evidence.commands 为 null)时命令卡路径零输出,不报错", () => {
    const evidence = evidenceOf({ execution: buildExecutionTree(twoTurnEvents(), []), result: resultOf({ phases: twoTurnPhases() }) });
    const { text } = executionText(evidence, OPTS);
    expect(text).not.toContain("FAILED COMMAND");
  });
});

describe("--grep:匹配面覆盖角色文本、工具名、input、result 与失败命令 display/stdout/stderr", () => {
  function evidenceWithEventsAndCommands(): AttemptEvidence {
    const phases: PhaseTiming[] = [
      ...twoTurnPhases(),
      {
        name: "eval.setup" as PhaseTiming["name"],
        durationMs: 100,
        children: [{ id: "cmd-node", kind: "command", label: "npm", startOffsetMs: 0, durationMs: 50, command: { display: "npm ci", exitCode: 1 } }],
      },
    ];
    return evidenceOf({
      execution: buildExecutionTree(twoTurnEvents(), []),
      result: resultOf({ phases }),
      commands: [{ timingNodeId: "cmd-node", phase: "eval.setup", display: "npm ci", exitCode: 1, stdout: "", stderr: "EACCES permission denied" }],
    });
  }

  it("按工具名命中(input/result 里没有出现的词也能命中)", () => {
    const evidence = evidenceWithEventsAndCommands();
    const { text, matches } = executionText(evidence, OPTS, { grep: /shell/ });
    expect(matches).toBe(1);
    expect(text).toContain("TOOL · shell");
    expect(text).toContain(`${LOCATOR} · eval/one · exp/a · s1/t1`);
  });

  it("按角色文本命中(USER/ASSISTANT 消息)", () => {
    const evidence = evidenceWithEventsAndCommands();
    const { matches, text } = executionText(evidence, OPTS, { grep: /thanks/ });
    expect(matches).toBe(1);
    expect(text).toContain("USER");
    expect(text).toContain("thanks");
  });

  it("按失败命令 display/stderr 命中,定位行带 phase", () => {
    const evidence = evidenceWithEventsAndCommands();
    const { matches, text } = executionText(evidence, OPTS, { grep: /EACCES/ });
    expect(matches).toBe(1);
    expect(text).toContain("FAILED COMMAND · eval.setup");
    expect(text).toContain(`${LOCATOR} · eval/one · exp/a · eval.setup`);
  });

  it("0 命中返回空文本与 matches: 0,不是报错或整段落空的「no events」文案", () => {
    const evidence = evidenceWithEventsAndCommands();
    const { text, matches } = executionText(evidence, OPTS, { grep: /nonexistent-pattern-xyz/ });
    expect(matches).toBe(0);
    expect(text).toBe("");
  });

  it("命中卡片照常受预览预算约束,截断尾巴带展开句柄", () => {
    const bigText = "y".repeat(9000);
    const events: StreamEvent[] = [
      { type: "message", role: "user", text: "start" },
      { type: "thinking", text: bigText },
    ];
    const evidence = evidenceOf({ execution: buildExecutionTree(events, []), result: resultOf({ phases: twoTurnPhases() }) });
    const { text, matches } = executionText(evidence, OPTS, { grep: /y{10}/ });
    expect(matches).toBe(1);
    expect(text).toContain("--expand t1.c2");
    expect((text.match(/y/g) ?? []).length).toBeLessThan(9000);
  });
});
