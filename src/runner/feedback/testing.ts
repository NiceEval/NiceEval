// 测试专用:确定性假 FeedbackIO。coordinator 与 human/json renderer 测试共用,
// 好让「同一种 fake IO 的搭建方式」只维护一份 —— 不在每个测试文件里各自 monkey-patch
// `process.stdout`/`process.stderr`/`Date.now`/`setInterval`。
//
// 只在测试导入(`from "./testing.ts"`),不进 index.ts 的生产条形码出口。

import type { FeedbackClock, FeedbackIO, FeedbackStream } from "./io.ts";

export interface FakeFeedbackStream extends FeedbackStream {
  /** 按写入顺序累积的完整历史,供断言「写了几次、写了什么」。 */
  readonly writes: readonly string[];
  isTTY: boolean;
  columns: number;
  rows: number;
}

function createFakeStream(overrides: Partial<Pick<FakeFeedbackStream, "isTTY" | "columns" | "rows">> = {}): FakeFeedbackStream {
  const writes: string[] = [];
  return {
    isTTY: overrides.isTTY ?? false,
    columns: overrides.columns ?? 100,
    rows: overrides.rows ?? 30,
    writes,
    write(text) {
      writes.push(text);
    },
  };
}

export interface FakeFeedbackIO {
  readonly io: FeedbackIO;
  readonly stdout: FakeFeedbackStream;
  readonly stderr: FakeFeedbackStream;
  /** 手动推进时钟 ms 毫秒;推进途中到期的 setInterval 回调按到期顺序依次同步触发
   *  (每次到期都重新入队下一次到期,不会因为一次 advance 跨越多个周期而漏触发)。 */
  advance(ms: number): void;
  /** 当前仍在运行(未被 clearInterval)的定时器数量,断言 stopDynamic()/finish() 之后
   *  没有遗留定时器时用。 */
  activeTimerCount(): number;
}

interface FakeTimer {
  id: number;
  fn: () => void;
  intervalMs: number;
  nextFireAt: number;
  cleared: boolean;
}

/** 创建一份完全确定性的假 IO；env 默认空对象，因此 human renderer 默认未设置 NO_COLOR。 */
export function createFakeFeedbackIO(
  opts: {
    stdout?: Partial<Pick<FakeFeedbackStream, "isTTY" | "columns" | "rows">>;
    stderr?: Partial<Pick<FakeFeedbackStream, "isTTY" | "columns" | "rows">>;
    env?: Readonly<globalThis.Record<string, string | undefined>>;
    startAt?: number;
  } = {},
): FakeFeedbackIO {
  const stdout = createFakeStream(opts.stdout);
  const stderr = createFakeStream(opts.stderr);
  let now = opts.startAt ?? 0;
  let nextId = 1;
  const timers = new Map<number, FakeTimer>();

  const clock: FeedbackClock = {
    now: () => now,
    setInterval: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { id, fn, intervalMs: ms, nextFireAt: now + ms, cleared: false });
      return { _tag: "FakeFeedbackTimer", id };
    },
    clearInterval: (handle) => {
      if (handle._tag !== "FakeFeedbackTimer") {
        throw new TypeError("createFakeFeedbackIO received a non-fake timer handle");
      }
      const id = handle.id;
      const timer = timers.get(id);
      if (timer) timer.cleared = true;
      timers.delete(id);
    },
  };

  const io: FeedbackIO = { stdout, stderr, env: opts.env ?? {}, clock };

  function advance(ms: number): void {
    const target = now + ms;
    // 按到期时间逐个触发,支持一次 advance 跨越同一个定时器的多个周期,也支持多个不同
    // 定时器交错到期 —— 每次只处理「当前最早到期」的那一个,触发后立即重新计算下一次到期。
    for (;;) {
      let earliest: FakeTimer | undefined;
      for (const timer of timers.values()) {
        if (timer.cleared) continue;
        if (timer.nextFireAt > target) continue;
        if (!earliest || timer.nextFireAt < earliest.nextFireAt) earliest = timer;
      }
      if (!earliest) break;
      now = earliest.nextFireAt;
      earliest.nextFireAt += earliest.intervalMs;
      earliest.fn();
    }
    now = target;
  }

  function activeTimerCount(): number {
    return [...timers.values()].filter((t) => !t.cleared).length;
  }

  return { io, stdout, stderr, advance, activeTimerCount };
}
