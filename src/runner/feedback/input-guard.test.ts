// cases: docs/engineering/testing/unit/experiments-runner.md
// 分区「live 面板的键盘接管与自愈重绘」:契约见
// docs/feature/experiments/cli.md「键盘输入与画面自愈」。

import { describe, expect, it } from "vitest";
import { createInputGuard } from "./input-guard.ts";
import type { InputGuardCoordinator, InputGuardProcess, InputGuardStdin } from "./input-guard.ts";

interface FakeStdin extends InputGuardStdin {
  readonly rawModeCalls: readonly boolean[];
  readonly resumeCalls: number;
  readonly pauseCalls: number;
  listenerCount(): number;
  emitData(text: string): void;
}

function createFakeStdin(isTTY: boolean): FakeStdin {
  const listeners: Array<(chunk: Buffer | string) => void> = [];
  const rawModeCalls: boolean[] = [];
  let resumeCalls = 0;
  let pauseCalls = 0;
  return {
    isTTY,
    setRawMode: (mode) => rawModeCalls.push(mode),
    resume: () => {
      resumeCalls += 1;
    },
    pause: () => {
      pauseCalls += 1;
    },
    on: (_event, listener) => {
      listeners.push(listener);
    },
    off: (_event, listener) => {
      const idx = listeners.indexOf(listener);
      if (idx !== -1) listeners.splice(idx, 1);
    },
    get rawModeCalls() {
      return rawModeCalls;
    },
    get resumeCalls() {
      return resumeCalls;
    },
    get pauseCalls() {
      return pauseCalls;
    },
    listenerCount: () => listeners.length,
    emitData: (text) => {
      for (const listener of [...listeners]) listener(text);
    },
  };
}

interface FakeCoordinator extends InputGuardCoordinator {
  readonly forceRedrawCalls: number;
}

function createFakeCoordinator(): FakeCoordinator {
  let calls = 0;
  return {
    forceRedraw: () => {
      calls += 1;
    },
    get forceRedrawCalls() {
      return calls;
    },
  };
}

interface FakeProcess extends InputGuardProcess {
  readonly killCalls: readonly { pid: number; signal: string }[];
  listenerCount(event: string): number;
  emit(event: string): void;
}

function createFakeProcess(pid = 4242): FakeProcess {
  const listeners = new Map<string, Array<() => void>>();
  const killCalls: { pid: number; signal: string }[] = [];
  return {
    pid,
    kill: (targetPid, signal) => killCalls.push({ pid: targetPid, signal }),
    on: (event, listener) => {
      const arr = listeners.get(event) ?? [];
      arr.push(listener);
      listeners.set(event, arr);
    },
    off: (event, listener) => {
      const arr = listeners.get(event) ?? [];
      const idx = arr.indexOf(listener);
      if (idx !== -1) arr.splice(idx, 1);
    },
    get killCalls() {
      return killCalls;
    },
    listenerCount: (event) => (listeners.get(event) ?? []).length,
    emit: (event) => {
      for (const listener of [...(listeners.get(event) ?? [])]) listener();
    },
  };
}

describe("createInputGuard: stdin 与 stderr 都是 TTY 时接管键盘", () => {
  it("进入 raw mode、恢复读取,不回显——普通字节不触发重绘或中断", () => {
    const stdin = createFakeStdin(true);
    const coordinator = createFakeCoordinator();
    const proc = createFakeProcess();
    createInputGuard({ stdin, stderrIsTTY: true, coordinator, onInterrupt: () => {}, process: proc });

    expect(stdin.rawModeCalls).toEqual([true]);
    expect(stdin.resumeCalls).toBe(1);
    expect(stdin.listenerCount()).toBe(1);

    stdin.emitData("x");
    expect(coordinator.forceRedrawCalls).toBe(0);
  });

  it("收到 \\r 或 \\n 触发 coordinator.forceRedraw() 整帧重绘,连续多次按键各自触发一次(不去重)", () => {
    const stdin = createFakeStdin(true);
    const coordinator = createFakeCoordinator();
    createInputGuard({ stdin, stderrIsTTY: true, coordinator, onInterrupt: () => {}, process: createFakeProcess() });

    stdin.emitData("\r");
    expect(coordinator.forceRedrawCalls).toBe(1);
    stdin.emitData("\n");
    expect(coordinator.forceRedrawCalls).toBe(2);
    stdin.emitData("\r");
    expect(coordinator.forceRedrawCalls).toBe(3);
  });

  it("收到 \\x03 走与 SIGINT 完全相同的中断路径(调用注入的 onInterrupt,不在 guard 内部重新实现清理)", () => {
    const stdin = createFakeStdin(true);
    const coordinator = createFakeCoordinator();
    let interruptCount = 0;
    createInputGuard({
      stdin,
      stderrIsTTY: true,
      coordinator,
      onInterrupt: () => {
        interruptCount += 1;
      },
      process: createFakeProcess(),
    });

    stdin.emitData("\x03");
    expect(interruptCount).toBe(1);
    expect(coordinator.forceRedrawCalls).toBe(0); // Ctrl+C 不是重绘手势
  });

  it("一个 data 事件里混合多个字节时逐字节分派(如粘贴/一次性 flush 出的 '\\x03x\\r')", () => {
    const stdin = createFakeStdin(true);
    const coordinator = createFakeCoordinator();
    let interruptCount = 0;
    createInputGuard({
      stdin,
      stderrIsTTY: true,
      coordinator,
      onInterrupt: () => {
        interruptCount += 1;
      },
      process: createFakeProcess(),
    });

    stdin.emitData("\x03x\r");
    expect(interruptCount).toBe(1);
    expect(coordinator.forceRedrawCalls).toBe(1);
  });

  it("\\x1a(Ctrl+Z)先恢复终端模式再发 SIGTSTP;收到 SIGCONT 后重新进入 raw mode 并整帧重绘", () => {
    const stdin = createFakeStdin(true);
    const coordinator = createFakeCoordinator();
    const proc = createFakeProcess(4242);
    createInputGuard({ stdin, stderrIsTTY: true, coordinator, onInterrupt: () => {}, process: proc });

    stdin.emitData("\x1a");
    expect(stdin.rawModeCalls).toEqual([true, false]);
    expect(proc.killCalls).toEqual([{ pid: 4242, signal: "SIGTSTP" }]);

    proc.emit("SIGCONT");
    expect(stdin.rawModeCalls).toEqual([true, false, true]);
    expect(coordinator.forceRedrawCalls).toBe(1);
  });

  it("stop() 恢复终端模式、移除全部监听,重复调用只生效一次", () => {
    const stdin = createFakeStdin(true);
    const coordinator = createFakeCoordinator();
    const proc = createFakeProcess();
    const guard = createInputGuard({ stdin, stderrIsTTY: true, coordinator, onInterrupt: () => {}, process: proc });

    guard.stop();
    expect(stdin.rawModeCalls).toEqual([true, false]);
    expect(stdin.pauseCalls).toBe(1);
    expect(stdin.listenerCount()).toBe(0);
    expect(proc.listenerCount("SIGCONT")).toBe(0);
    expect(proc.listenerCount("SIGWINCH")).toBe(0);

    guard.stop(); // 幂等:不重复恢复/移除
    expect(stdin.rawModeCalls).toEqual([true, false]);
    expect(stdin.pauseCalls).toBe(1);
  });
});

describe("createInputGuard: 终端自愈(SIGWINCH)与非 TTY 场景", () => {
  it("终端 resize(SIGWINCH)同样触发 coordinator.forceRedraw() 整帧重绘,与回车同一条自愈机制", () => {
    const stdin = createFakeStdin(true);
    const coordinator = createFakeCoordinator();
    const proc = createFakeProcess();
    createInputGuard({ stdin, stderrIsTTY: true, coordinator, onInterrupt: () => {}, process: proc });

    proc.emit("SIGWINCH");
    expect(coordinator.forceRedrawCalls).toBe(1);
  });

  it("SIGWINCH 接线不依赖 stdin 是否 TTY——stderr 是 TTY 就该在终端 resize 时重绘", () => {
    const stdin = createFakeStdin(false);
    const coordinator = createFakeCoordinator();
    const proc = createFakeProcess();
    createInputGuard({ stdin, stderrIsTTY: true, coordinator, onInterrupt: () => {}, process: proc });

    expect(proc.listenerCount("SIGWINCH")).toBe(1);
    proc.emit("SIGWINCH");
    expect(coordinator.forceRedrawCalls).toBe(1);
  });

  it("stdin 非 TTY 时一个字节都不读:不进 raw mode、不 resume、不注册 data 监听", () => {
    const stdin = createFakeStdin(false);
    const coordinator = createFakeCoordinator();
    createInputGuard({ stdin, stderrIsTTY: true, coordinator, onInterrupt: () => {}, process: createFakeProcess() });

    expect(stdin.rawModeCalls).toEqual([]);
    expect(stdin.resumeCalls).toBe(0);
    expect(stdin.listenerCount()).toBe(0);
  });

  it("stderr 不是 TTY 时(即便 stdin 是 TTY)也不接管键盘,也不接 SIGWINCH——没有 live 面板可重绘", () => {
    const stdin = createFakeStdin(true);
    const coordinator = createFakeCoordinator();
    const proc = createFakeProcess();
    createInputGuard({ stdin, stderrIsTTY: false, coordinator, onInterrupt: () => {}, process: proc });

    expect(stdin.rawModeCalls).toEqual([]);
    expect(stdin.listenerCount()).toBe(0);
    expect(proc.listenerCount("SIGWINCH")).toBe(0);
  });

  it("非 TTY 场景下 stop() 仍然安全(no-op),不抛错", () => {
    const stdin = createFakeStdin(false);
    const coordinator = createFakeCoordinator();
    const guard = createInputGuard({ stdin, stderrIsTTY: false, coordinator, onInterrupt: () => {}, process: createFakeProcess() });
    expect(() => guard.stop()).not.toThrow();
  });
});
