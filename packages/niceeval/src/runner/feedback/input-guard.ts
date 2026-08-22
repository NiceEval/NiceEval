// live 面板期间的键盘接管与终端自愈(见 docs/feature/experiments/cli.md「键盘输入与画面自愈」)。
//
// live 面板靠相对光标回跳原地重绘,行数记账要求它是终端上唯一的写入者。键盘回显是记账之外
// 的写入者:一次回车就把光标顶下一行,此后每一帧都画在错位的位置,旧帧残片持续泄进
// scrollback(见 memory/stream-failure-panels-and-tty-input-guard.md)。所以 live 面板存在期间
// 这个模块接管 stdin:
//
// - stdin 是 TTY 且 stderr 也是 TTY(human dashboard 真的在画)时才进 raw mode、关闭回显 ——
//   普通按键不落屏、不进 scrollback,面板位置回到只有 renderer 一个写入者。
// - 回车(`\r`/`\n`)是主动重绘手势:调用 `coordinator.forceRedraw()` 清除面板并整帧重绘,
//   绕过「同帧不写」判断——它既回答「它还活着吗」,也是画面被外部干扰(SSH 重连、终端故障、
//   别的进程误写)弄乱后的自愈出口。
// - `\x03`(Ctrl+C)走与 SIGINT 完全相同的中断路径——raw mode 下终端自己不发信号,由调用方
//   (cli.ts)注入的 `onInterrupt` 复用已有的 signal 处理,不在这里重新实现一遍清理逻辑。
// - `\x1a`(Ctrl+Z)先恢复终端模式再向自身发 SIGTSTP;收到 SIGCONT 后重新进入 raw mode 并
//   整帧重绘。
// - 终端 resize(SIGWINCH)同样按「清除 + 整帧重绘」自愈,与框线体裁声明的 resize 重绘是
//   同一条机制;这条不依赖 stdin 是不是 TTY,只要 stderr(live 面板所在的流)是 TTY 就接线。
// - 任何退出路径(结束、中断、异常)都必须恢复终端模式、移除监听、不阻止进程自然退出;
//   stdin 非 TTY 时一个字节都不读、不接管。
//
// `forceRedraw()` 经 coordinator 内部的串行队列执行(见 coordinator.ts),与正常永久事件的
// clear→append→redraw 三步共用同一条队列,不会与它们交错写终端——这个模块因此不直接持有
// `FeedbackRenderer`,只依赖 coordinator 暴露的这一个方法。

/** 一份可注入的 stdin 面,只暴露这个模块需要的最小操作集(与 `FeedbackIO` 的 stdout/stderr
 *  同一种"不直接碰全局 process"的注入方式,测试用假实现驱动确定性场景)。 */
export interface InputGuardStdin {
  readonly isTTY: boolean;
  setRawMode(mode: boolean): void;
  resume(): void;
  pause(): void;
  on(event: "data", listener: (chunk: Buffer | string) => void): void;
  off(event: "data", listener: (chunk: Buffer | string) => void): void;
}

/** input-guard 需要的 coordinator 面:只有一个方法,见 coordinator.ts 的 `forceRedraw()` 注释。 */
export interface InputGuardCoordinator {
  forceRedraw(): void;
}

/** 当前进程的信号收发面;默认使用全局 `process`,测试可注入假实现以断言 SIGCONT 监听的
 *  注册/移除时序,不需要真的操作当前进程或依赖真实 SIGTSTP/SIGCONT。 */
export interface InputGuardProcess {
  readonly pid: number;
  kill(pid: number, signal: string): void;
  on(event: string, listener: () => void): void;
  off(event: string, listener: () => void): void;
}

export interface InputGuardOptions {
  stdin: InputGuardStdin;
  /** live 面板实际画在哪个流上的 TTY 判定(与 human.ts 的 `panelCapabilityForFeedback` 同源)。 */
  stderrIsTTY: boolean;
  coordinator: InputGuardCoordinator;
  /** `\x03` 走与 SIGINT 完全相同的中断路径;由调用方(cli.ts)提供,复用已有的 signal 处理,
   *  这个模块不重新实现一遍清理/退出逻辑。 */
  onInterrupt: () => void;
  /** 可选:注入进程信号面,省略时使用全局 `process`。 */
  process?: InputGuardProcess;
}

export interface InputGuard {
  /** 恢复终端模式、移除全部监听。可重复调用,只有第一次生效(结束/中断/异常路径都会调用,
   *  互不冲突)。 */
  stop(): void;
}

const CTRL_C = "\x03";
const CTRL_Z = "\x1a";
const CARRIAGE_RETURN = "\r";
const LINE_FEED = "\n";

/** 用全局 `process` 适配 `InputGuardProcess`;只在没有显式注入时使用。 */
function globalProcessAdapter(): InputGuardProcess {
  return {
    pid: process.pid,
    kill: (pid, signal) => process.kill(pid, signal),
    on: (event, listener) => {
      process.on(event, listener);
    },
    off: (event, listener) => {
      process.off(event, listener);
    },
  };
}

export function createInputGuard(options: InputGuardOptions): InputGuard {
  const { stdin, stderrIsTTY, coordinator, onInterrupt } = options;
  const proc = options.process ?? globalProcessAdapter();

  let stopped = false;

  // resize 自愈不依赖键盘接管资格:只要 live 面板画在的流(stderr)是 TTY,终端尺寸变化就该
  // 触发重绘,即便 stdin 本身不是交互终端(例如 stdin 被重定向、stderr 仍连着真实终端)。
  const onResize = (): void => coordinator.forceRedraw();
  if (stderrIsTTY) proc.on("SIGWINCH", onResize);

  const keyboardActive = stdin.isTTY && stderrIsTTY;
  let onData: ((chunk: Buffer | string) => void) | undefined;
  let onResume: (() => void) | undefined;

  if (keyboardActive) {
    const suspend = (): void => {
      stdin.setRawMode(false);
      proc.kill(proc.pid, "SIGTSTP");
    };
    onResume = (): void => {
      stdin.setRawMode(true);
      coordinator.forceRedraw();
    };
    onData = (chunk: Buffer | string): void => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (const byte of text) {
        if (byte === CTRL_C) {
          onInterrupt();
        } else if (byte === CARRIAGE_RETURN || byte === LINE_FEED) {
          coordinator.forceRedraw();
        } else if (byte === CTRL_Z) {
          suspend();
        }
        // 其余字节吞掉:live 面板期间键盘回显是唯一要杜绝的"绕过 renderer 的写入者"。
      }
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
    proc.on("SIGCONT", onResume);
  }

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (stderrIsTTY) proc.off("SIGWINCH", onResize);
      if (keyboardActive) {
        if (onData) stdin.off("data", onData);
        if (onResume) proc.off("SIGCONT", onResume);
        stdin.setRawMode(false);
        stdin.pause();
      }
    },
  };
}

/** 生产实现:包一层真实 `process.stdin`(与 io.ts 的 `createNodeFeedbackIO` 同一种"生产环境
 *  才碰全局 process"的分层)。`setRawMode` 只有 stdin 真的是 TTY 时才存在,非 TTY 时保持
 *  no-op——`createInputGuard` 只在 `isTTY` 为真时才会调用它,这里的兜底只是防御。 */
export function createNodeInputGuardStdin(): InputGuardStdin {
  return {
    get isTTY() {
      return process.stdin.isTTY === true;
    },
    setRawMode: (mode) => {
      process.stdin.setRawMode?.(mode);
    },
    resume: () => {
      process.stdin.resume();
    },
    pause: () => {
      process.stdin.pause();
    },
    on: (event, listener) => {
      process.stdin.on(event, listener);
    },
    off: (event, listener) => {
      process.stdin.off(event, listener);
    },
  };
}
