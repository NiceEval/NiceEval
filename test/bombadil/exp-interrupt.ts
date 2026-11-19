// 跨进程保证：进程终止与信号——终端中断后 CLI 退出，已启动的子进程被回收
import { always, eventually, not } from "@antithesishq/bombadil";
import { actions, extract, type ActionTemplate } from "@antithesishq/bombadil/terminal";

export { exitSuccess, noReplacementChars } from "@antithesishq/bombadil/terminal/defaults";

let interrupted = false;
const terminal = extract((state) => {
  const text = Array.from({ length: state.grid.size.rows }, (_, row) => state.grid.rowText(row)).join("\n");
  const action = state.lastAction;
  if (action && "TypeText" in action && action.TypeText === "\x03") interrupted = true;
  return {
    started: text.includes("test: exp can be interrupted") || text.includes("running Eval"),
    interrupted,
    verified: text.includes("test: exp interrupted and children gone"),
    exit: state.exitStatus,
  };
});

export const controls = actions(() => {
  const resize = { Resize: { columns: [60, 120], rows: [20, 35] } } satisfies ActionTemplate;
  return terminal.current?.started === true && !terminal.current.interrupted
    ? [{ TypeText: { CharSet: [{ Literal: "\x03" }] } }, resize]
    : [resize];
});

// @feature docs/feature/run/README.md#interrupt-recovery
export const expInterruptExitsAndReapsChildren = always(
  not(() => terminal.current?.interrupted === true).or(
    eventually(() => terminal.current?.exit?.code === 0 && terminal.current.verified).within(5, "seconds"),
  ),
).and(always(() => terminal.current?.exit == null || terminal.current.verified));
