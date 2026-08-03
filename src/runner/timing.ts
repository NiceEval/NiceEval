// attempt / Run 双时钟域计时:LifecyclePhase 锚点闭集 + 开放 key 的 TimingActivity 子树。
// 契约见 docs/feature/record/architecture.md「两层时间模型」:
// - attempt 侧 phases[] 是锚点序列,children 相对 attempt 单调时钟起点;
// - Run 侧 RunMeta.timings 相对 Run 单调时钟起点;
// - 两域 offset 不得混算;未知 activity key 原样保留。

import { commandLimit } from "../sandbox/deadline.ts";
import { redactSensitiveText } from "../sandbox/redaction.ts";
import type { CommandLimitAttribution, LifecyclePhase, PhaseTiming, TimingActivity, TimingOrigin } from "./types.ts";

/** 主链成员(enterPhase 推进;进入下一个即关闭上一个)。收尾段用 measureClosing 单独计时。 */
const CLOSING_PHASES: ReadonlySet<LifecyclePhase> = new Set([
  "agent.teardown",
  "sandbox.cleanup",
  "sandbox.suspend",
  "sandbox.stop",
]);

/** 构造 attempt 支 TimingOrigin 的便捷函数(runner / 测试共用)。 */
export function attemptOrigin(phase: LifecyclePhase, timingNodeId?: string): TimingOrigin {
  return {
    scope: "attempt",
    phase,
    ...(timingNodeId !== undefined ? { timingNodeId } : {}),
  };
}

/** 构造 run 支 TimingOrigin。 */
export function runOrigin(timingNodeId: string): TimingOrigin {
  return { scope: "run", timingNodeId };
}

export interface TimingRecorder {
  /** 进入一个主链阶段:关闭上一个开着的主链条目,开一个新条目。 */
  enter(phase: LifecyclePhase): void;
  /** 把当前开着的阶段标记为 failed 并关闭(其后无主链条目)。 */
  failCurrent(): void;
  /** 关闭当前开着的主链条目(正常走完主链时在收尾前调用)。 */
  closeCurrent(): void;
  /** 计时一个收尾段:无论成败都记条目,失败标 failed。 */
  measureClosing<T>(phase: LifecyclePhase, fn: () => Promise<T> | T): Promise<T>;
  /** 往「当前挂载点」挂一个 activity 子节点。 */
  child(node: Omit<TimingActivity, "id">): TimingActivity | undefined;
  /** 在指定的已有节点下挂子节点。 */
  childOf(parent: TimingActivity, node: Omit<TimingActivity, "id">): TimingActivity;
  /** 把后续 child() 的挂载点压到 parent 下;与 popParent 成对。 */
  pushParent(parent: TimingActivity): void;
  popParent(): void;
  /** 直接补记一个已测好耗时的阶段条目(sandbox.stop 这类 Scope release 段用)。 */
  record(phase: LifecyclePhase, durationMs: number, failed?: boolean): void;
  /** 相对 attempt 单调时钟起点的当前偏移(ms)。 */
  offsetNow(): number;
  /** 封口:关闭残留的开条目,产出 PhaseTiming[](一个阶段都没记录时返回 undefined)。 */
  finalize(): PhaseTiming[] | undefined;
}

/** Run 级共享工作的时间树 recorder(与 attempt 共用 TimingActivity 形状,独立时钟域)。 */
export interface RunTimingRecorder {
  child(node: Omit<TimingActivity, "id">): TimingActivity;
  childOf(parent: TimingActivity, node: Omit<TimingActivity, "id">): TimingActivity;
  pushParent(parent: TimingActivity): void;
  popParent(): void;
  offsetNow(): number;
  /** 封口:产出 TimingActivity[](一个都没记录时返回 undefined)。 */
  finalize(): TimingActivity[] | undefined;
}

/**
 * 把 RunTimingRecorder 接到 ArtifactPrepareTimingHook:
 * prepare 记为开放 key `agent.artifact.prepare`,走 Run 时钟域。
 */
export function artifactPrepareTimingHook(
  recorder: RunTimingRecorder,
): import("../agents/provisioner.ts").ArtifactPrepareTimingHook {
  return {
    async activity(key, attrs, run) {
      const startOffsetMs = recorder.offsetNow();
      const label = `${attrs.identity.agent}@${attrs.identity.version}`;
      try {
        const result = await run();
        recorder.child({
          key,
          label,
          startOffsetMs,
          durationMs: Math.max(0, recorder.offsetNow() - startOffsetMs),
        });
        return result;
      } catch (e) {
        recorder.child({
          key,
          label,
          startOffsetMs,
          durationMs: Math.max(0, recorder.offsetNow() - startOffsetMs),
          failed: true,
        });
        throw e;
      }
    },
  };
}

interface ActivityTree {
  child(node: Omit<TimingActivity, "id">, requireOpen?: boolean): TimingActivity | undefined;
  childOf(parent: TimingActivity, node: Omit<TimingActivity, "id">): TimingActivity;
  pushParent(parent: TimingActivity): void;
  popParent(): void;
  offsetNow(): number;
  nextId(): string;
  roots(): TimingActivity[];
}

function createActivityTree(now: () => number): ActivityTree {
  const origin = now();
  const roots: TimingActivity[] = [];
  let nodeSeq = 0;
  const parentStack: TimingActivity[] = [];

  const offset = () => Math.max(0, Math.round(now() - origin));
  const nextId = () => `n${++nodeSeq}`;

  return {
    nextId,
    offsetNow: offset,
    roots: () => roots,
    child(node, requireOpen = false) {
      const full: TimingActivity = { id: nextId(), ...node };
      const top = parentStack[parentStack.length - 1];
      if (top) {
        (top.children ??= []).push(full);
        return full;
      }
      if (requireOpen) return undefined;
      roots.push(full);
      return full;
    },
    childOf(parent, node) {
      const full: TimingActivity = { id: nextId(), ...node };
      (parent.children ??= []).push(full);
      return full;
    },
    pushParent(parent) {
      parentStack.push(parent);
    },
    popParent() {
      parentStack.pop();
    },
  };
}

interface OpenPhase {
  name: LifecyclePhase;
  startedAt: number;
  children: TimingActivity[];
}

export function createTimingRecorder(now: () => number = () => performance.now()): TimingRecorder {
  const origin = now();
  const phases: PhaseTiming[] = [];
  let open: OpenPhase | undefined;
  const parentStack: TimingActivity[] = [];
  let nodeSeq = 0;

  const offset = () => Math.max(0, Math.round(now() - origin));
  const nextId = () => `n${++nodeSeq}`;

  function close(failed?: true): void {
    if (!open) return;
    const entry: PhaseTiming = {
      name: open.name,
      durationMs: Math.max(0, Math.round(now() - open.startedAt)),
      ...(failed ? { failed: true as const } : {}),
      ...(open.children.length > 0 ? { children: open.children } : {}),
    };
    phases.push(entry);
    open = undefined;
  }

  function attachChild(node: Omit<TimingActivity, "id">): TimingActivity | undefined {
    const full: TimingActivity = { id: nextId(), ...node };
    const top = parentStack[parentStack.length - 1];
    if (top) {
      (top.children ??= []).push(full);
      return full;
    }
    if (!open) return undefined;
    open.children.push(full);
    return full;
  }

  return {
    enter(phase) {
      if (CLOSING_PHASES.has(phase)) {
        close();
        return;
      }
      if (
        phase === "agent.run" ||
        phase === "sandbox.prepare.eval" ||
        phase === "sandbox.prepare.experiment"
      ) return;
      close();
      open = { name: phase, startedAt: now(), children: [] };
    },
    failCurrent() {
      close(true);
    },
    closeCurrent() {
      close();
    },
    async measureClosing(phase, fn) {
      close();
      const startedAt = now();
      const children: TimingActivity[] = [];
      open = { name: phase, startedAt, children };
      try {
        const result = await fn();
        close();
        return result;
      } catch (e) {
        close(true);
        throw e;
      }
    },
    child: attachChild,
    childOf(parent, node) {
      const full: TimingActivity = { id: nextId(), ...node };
      (parent.children ??= []).push(full);
      return full;
    },
    pushParent(parent) {
      parentStack.push(parent);
    },
    popParent() {
      parentStack.pop();
    },
    record(phase, durationMs, failed) {
      close();
      phases.push({
        name: phase,
        durationMs: Math.max(0, Math.round(durationMs)),
        ...(failed ? { failed: true as const } : {}),
      });
    },
    offsetNow: offset,
    finalize() {
      close();
      return phases.length > 0 ? phases : undefined;
    },
  };
}

export function createRunTimingRecorder(now: () => number = () => performance.now()): RunTimingRecorder {
  const tree = createActivityTree(now);
  return {
    child(node) {
      return tree.child(node)!;
    },
    childOf: tree.childOf,
    pushParent: tree.pushParent,
    popParent: tree.popParent,
    offsetNow: tree.offsetNow,
    finalize() {
      const roots = tree.roots();
      return roots.length > 0 ? roots : undefined;
    },
  };
}

/** 命令的有界脱敏摘要:先按已知敏感值替换，再做 argv 拼接结果的 160 字符截断。 */
export function commandDisplay(
  cmd: string,
  args?: readonly string[],
  sensitiveValues: Iterable<string> = [],
): string {
  const s = redactSensitiveText([cmd, ...(args ?? [])].join(" "), sensitiveValues);
  return s.length > 160 ? `${s.slice(0, 159)}…` : s;
}

/** key=sandbox.command 节点的便捷构造。 */
export function commandNode(opts: {
  display: string;
  startOffsetMs: number;
  durationMs: number;
  exitCode?: number;
  failed?: boolean;
  checked?: boolean;
  /** 这条命令生效的时限归属;四层解析链一个上限都没声明时省略。 */
  limit?: CommandLimitAttribution;
}): Omit<TimingActivity, "id"> {
  return {
    key: "sandbox.command",
    label: opts.display.split(" ")[0] ?? opts.display,
    startOffsetMs: opts.startOffsetMs,
    durationMs: opts.durationMs,
    ...(opts.failed ? { failed: true as const } : {}),
    command: {
      display: opts.display,
      ...(opts.exitCode !== undefined ? { exitCode: opts.exitCode } : {}),
      ...(opts.checked !== undefined ? { checked: opts.checked } : {}),
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
    },
  };
}

/**
 * 一条命令的时限归属:优先级不在这里重写一遍,直接问 `commandLimit`(时限派生的单源),
 * 只把它的 `explicit` 翻成来源层的词——显式声明归 `command-timeout`,其余归 `attempt-deadline`
 * (未显式传 `timeoutMs` 的命令拿的就是 deadline 剩余量)。两者都没有时返回 `undefined`:
 * 没有线就是没有线,不给节点编一条。
 */
export function commandLimitAttribution(
  opts: { timeoutMs?: number } | undefined,
  base: { commandTimeoutMs?: number; deadlineAt?: number },
  now = Date.now(),
): CommandLimitAttribution | undefined {
  const limit = commandLimit(opts, base, now);
  if (limit.timeoutMs === undefined) return undefined;
  return { source: limit.explicit ? "command-timeout" : "attempt-deadline", limitMs: limit.timeoutMs };
}

/** key=sandbox.prepare 节点的便捷构造；prepare 与 cleanup 两个锚点共用。 */
export function sandboxPrepareActivity(opts: {
  label: string;
  startOffsetMs: number;
  durationMs?: number;
  failed?: boolean;
}): Omit<TimingActivity, "id"> {
  return {
    key: "sandbox.prepare",
    label: opts.label,
    startOffsetMs: opts.startOffsetMs,
    durationMs: opts.durationMs ?? 0,
    ...(opts.failed ? { failed: true as const } : {}),
  };
}

/** key=agent.turn 节点的便捷构造。 */
export function turnActivity(opts: {
  label: string;
  startOffsetMs: number;
  durationMs: number;
  sessionIndex: number;
  turnIndex: number;
  failed?: boolean;
  turnId?: string;
  traceId?: string;
  traceAttribution?: TimingActivity["traceAttribution"];
  usage?: TimingActivity["usage"];
}): Omit<TimingActivity, "id"> {
  return {
    key: "agent.turn",
    label: opts.label,
    startOffsetMs: opts.startOffsetMs,
    durationMs: opts.durationMs,
    ...(opts.failed ? { failed: true as const } : {}),
    sessionIndex: opts.sessionIndex,
    turnIndex: opts.turnIndex,
    ...(opts.turnId !== undefined ? { turnId: opts.turnId } : {}),
    ...(opts.traceId !== undefined ? { traceId: opts.traceId } : {}),
    ...(opts.traceAttribution !== undefined ? { traceAttribution: opts.traceAttribution } : {}),
    ...(opts.usage !== undefined ? { usage: opts.usage } : {}),
  };
}

/** key=workspace.diff.export 节点的便捷构造。 */
export function workspaceDiffExportActivity(opts: {
  label: string;
  startOffsetMs: number;
  durationMs?: number;
  failed?: boolean;
}): Omit<TimingActivity, "id"> {
  return {
    key: "workspace.diff.export",
    label: opts.label,
    startOffsetMs: opts.startOffsetMs,
    durationMs: opts.durationMs ?? 0,
    ...(opts.failed ? { failed: true as const } : {}),
  };
}
