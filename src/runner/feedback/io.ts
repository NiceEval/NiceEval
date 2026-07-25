// 可注入的终端 I/O 面:feedback coordinator(coordinator.ts)与两种 profile renderer(后续阶段)
// 只经这里读写 stdout/stderr、探测 TTY/尺寸、拿时钟与定时器 —— 不直接引用全局 `process`。
//
// 这样测试能喂一份完全确定性的假 IO(见 testing.ts 的 createFakeFeedbackIO):不靠 monkey-patch
// `process.stdout`/`process.stderr`/`Date.now`/`setInterval`,断言也不必和真实终端的时序、
// 尺寸竞争。生产环境用 createNodeFeedbackIO() 包一层真实 process。

/** 一路输出流的最小面:coordinator/renderer 只需要写文本、探测是否 TTY 与当前尺寸。 */
export interface FeedbackStream {
  write(text: string): void;
  readonly isTTY: boolean;
  /** 非 TTY 或探测不到时的合理兜底见各实现;调用方不需要自己再猜省略值。 */
  readonly columns: number;
  readonly rows: number;
}

/** setInterval 返回句柄的不透明品牌类型 —— 真实实现是 NodeJS.Timeout,测试实现是数字 id,
 *  调用方永远不检视内部结构,只用来传回 clearInterval。 */
export type FeedbackTimerHandle = { readonly __brand: "FeedbackTimerHandle" };

/** coordinator 需要的最小时钟面:当前时间 + 周期定时器。不用 Date.now()/setInterval 直接调用,
 *  好让 reducer 之外唯一还需要「时间」概念的这一层(tick 节奏、heartbeat 空闲判断)也能被
 *  确定性地驱动,不依赖真实挂钟等待。 */
export interface FeedbackClock {
  now(): number;
  setInterval(fn: () => void, ms: number): FeedbackTimerHandle;
  clearInterval(handle: FeedbackTimerHandle): void;
}

/** feedback coordinator 依赖的完整 IO 面。两种 profile renderer(human/json)也应该经这里
 *  读写终端,不直接 import `process` —— 这是「不要把 process 到处传」与「测试不靠全局
 *  monkey-patch」两个目标共用的同一个注入点。 */
export interface FeedbackIO {
  readonly stdout: FeedbackStream;
  readonly stderr: FeedbackStream;
  /** 只读环境变量面(profile 自动检测的 CI 标记、NO_COLOR 等都从这里读,不直接碰
   *  process.env),同样是为了让 profile.ts 的纯函数可测。 */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly clock: FeedbackClock;
}

function wrapStream(stream: NodeJS.WriteStream): FeedbackStream {
  return {
    write: (text) => {
      stream.write(text);
    },
    get isTTY() {
      return stream.isTTY === true;
    },
    get columns() {
      return stream.columns || 100;
    },
    get rows() {
      return stream.rows || 30;
    },
  };
}

/** 生产实现:包一层真实 `process`。setInterval 句柄 `.unref()`—— tick 定时器本身绝不能是
 *  进程活着的理由,`stopDynamic()`/`finish()` 之外的任何异常退出路径也不会被它拖住。 */
export function createNodeFeedbackIO(): FeedbackIO {
  return {
    stdout: wrapStream(process.stdout),
    stderr: wrapStream(process.stderr),
    env: process.env,
    clock: {
      now: () => Date.now(),
      setInterval: (fn, ms) => {
        const handle = setInterval(fn, ms);
        handle.unref?.();
        return handle as unknown as FeedbackTimerHandle;
      },
      clearInterval: (handle) => {
        clearInterval(handle as unknown as ReturnType<typeof setInterval>);
      },
    },
  };
}
