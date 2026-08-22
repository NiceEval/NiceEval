// 输出形态解析(见 docs/feature/experiments/cli.md「每条命令一个人读 text 面,`--json` 是机器面」
// 与 memory/exp-output-two-forms-ruling.md)。只有一个分支变量:`--json` 是否传入 —— 没有
// `auto`/CI 环境变量嗅探,没有第三档;TTY 只决定人读文本内部走哪个版式(live 面板还是非 TTY
// 追加流),那是 human.ts 自己按 `io.stderr.isTTY` 再分派的职责,不改变这里的两选一结果。

import type { OutputProfile } from "../types.ts";

export interface ResolveOutputFormInput {
  /** `--json` 是否传入;唯一决定机器面/人读文本的变量。 */
  json: boolean;
  /**
   * 只决定人读文本内部走 TTY live 面板还是非 TTY 追加流(见 human.ts 的 `createHumanRenderer`),
   * 不影响这个函数的返回值 —— 保留在签名里是为了让调用方一次性传入全部已知的显示相关输入,
   * 不代表这里会用它在 "json"/"human" 之间做选择。这个函数不读 `process.env`(没有形参接收
   * 环境变量),结构上就不可能被 CI 平台标记影响。
   */
  isTTY: boolean;
}

/** `--json` 即机器面,否则人读文本。纯函数,不读任何环境变量。 */
export function resolveOutputForm(input: ResolveOutputFormInput): OutputProfile {
  return input.json ? "json" : "human";
}
