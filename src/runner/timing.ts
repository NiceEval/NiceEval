// attempt 级阶段计时:LifecyclePhase 主链/收尾段的耗时 + 阶段内时间树(hook / turn / command)。
// 契约见 docs/feature/record/architecture.md「result.json」的 PhaseTiming / TimingNode:
// 数组顺序即执行顺序;没执行的阶段不写 0 值条目;收尾段不计入 durationMs 口径但照常计时;
// 结果封口发生在 Effect Scope release 完成之后(sandbox.stop 也向这个 recorder 写入)。

import type { LifecyclePhase, PhaseTiming, TimingNode, TimingNodeKind } from "./types.ts";

/** 主链成员(enterPhase 推进;进入下一个即关闭上一个)。收尾段用 measureClosing 单独计时。 */
const CLOSING_PHASES: ReadonlySet<LifecyclePhase> = new Set([
  "eval.teardown",
  "agent.teardown",
  "sandbox.teardown",
  "sandbox.suspend",
  "sandbox.stop",
]);

export interface TimingRecorder {
  /** 进入一个主链阶段:关闭上一个开着的主链条目,开一个新条目。 */
  enter(phase: LifecyclePhase): void;
  /** 把当前开着的阶段标记为 failed 并关闭(其后无主链条目)。 */
  failCurrent(): void;
  /** 关闭当前开着的主链条目(正常走完主链时在收尾前调用)。 */
  closeCurrent(): void;
  /** 计时一个收尾段(eval/agent/sandbox teardown、suspend、stop):无论成败都记条目,失败标 failed。 */
  measureClosing<T>(phase: LifecyclePhase, fn: () => Promise<T> | T): Promise<T>;
  /** 往「当前挂载点」挂一个时间树子节点:有 pushParent 的父节点则挂它下面(hook 内的 command),
   *  否则挂当前开着的阶段;都没有时静默丢弃。 */
  child(node: Omit<TimingNode, "id">): TimingNode | undefined;
  /** 在指定的已有节点下挂子节点。 */
  childOf(parent: TimingNode, node: Omit<TimingNode, "id">): TimingNode;
  /** 把后续 child() 的挂载点压到 parent 下(hook 执行期间);与 popParent 成对。 */
  pushParent(parent: TimingNode): void;
  popParent(): void;
  /** 直接补记一个已测好耗时的阶段条目(sandbox.stop 这类 Scope release 段用)。 */
  record(phase: LifecyclePhase, durationMs: number, failed?: boolean): void;
  /** 相对 attempt 单调时钟起点的当前偏移(ms)。 */
  offsetNow(): number;
  /** 封口:关闭残留的开条目,产出 PhaseTiming[](一个阶段都没记录时返回 undefined)。 */
  finalize(): PhaseTiming[] | undefined;
}

interface OpenPhase {
  name: LifecyclePhase;
  startedAt: number;
  children: TimingNode[];
}

export function createTimingRecorder(now: () => number = () => performance.now()): TimingRecorder {
  const origin = now();
  const phases: PhaseTiming[] = [];
  let open: OpenPhase | undefined;
  let nodeSeq = 0;
  const parentStack: TimingNode[] = [];

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

  return {
    enter(phase) {
      if (CLOSING_PHASES.has(phase)) {
        // 收尾段经 measureClosing 计时;enter 只负责主链推进,这里防御性关掉主链残留。
        close();
        return;
      }
      // agent.run 是唯一的嵌套成员:只作归因值,不在 phases 里单列(不关闭 eval.run)。
      if (phase === "agent.run") return;
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
      const children: TimingNode[] = [];
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
    child(node) {
      const full: TimingNode = { id: nextId(), ...node };
      const top = parentStack[parentStack.length - 1];
      if (top) {
        (top.children ??= []).push(full);
        return full;
      }
      if (!open) return undefined;
      open.children.push(full);
      return full;
    },
    childOf(parent, node) {
      const full: TimingNode = { id: nextId(), ...node };
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
      phases.push({ name: phase, durationMs: Math.max(0, Math.round(durationMs)), ...(failed ? { failed: true as const } : {}) });
    },
    offsetNow: offset,
    finalize() {
      close();
      return phases.length > 0 ? phases : undefined;
    },
  };
}

/** 命令的有界脱敏摘要:argv 拼接 + 160 字符截断;env 值与 stdout/stderr 不进入时间树。 */
export function commandDisplay(cmd: string, args?: readonly string[]): string {
  const s = [cmd, ...(args ?? [])].join(" ");
  return s.length > 160 ? `${s.slice(0, 159)}…` : s;
}

/** kind=command 节点的便捷构造。 */
export function commandNode(opts: {
  display: string;
  startOffsetMs: number;
  durationMs: number;
  exitCode?: number;
  failed?: boolean;
}): Omit<TimingNode, "id"> {
  return {
    kind: "command" as TimingNodeKind,
    label: opts.display.split(" ")[0] ?? opts.display,
    startOffsetMs: opts.startOffsetMs,
    durationMs: opts.durationMs,
    ...(opts.failed ? { failed: true as const } : {}),
    command: { display: opts.display, ...(opts.exitCode !== undefined ? { exitCode: opts.exitCode } : {}) },
  };
}
