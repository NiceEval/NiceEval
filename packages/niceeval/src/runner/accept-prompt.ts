// `--accept` 不带值:TTY 下逐原因标记(契约见 docs/feature/experiments/cli.md
// 「`--accept` 不带值:TTY 下逐原因标记」)。
//
// 带 selector 的 `--accept` 是非交互授权,CI 与脚本用它;这里只解决「人不想手拼 selector」。
// 交互本身是一层薄壳:问什么由调用方给的选项决定,怎么读一行由注入的 reader 决定——
// 于是单测注入假输入就能证明「选复用就携带、选重跑就派发」,不需要一台真 TTY。

import { createInterface } from "node:readline/promises";


/** 一条可被授权的差异,连同它在本次计划里的影响面。 */
export interface AcceptChoice {
  selector: string;
  from?: string;
  to?: string;
  /** 本次计划里被这条差异拦下的 eval 数。 */
  evals: number;
}

/** 读一行输入的能力;真 TTY 走 `node:readline/promises`,测试注入假实现。 */
export interface PromptReader {
  question(prompt: string): Promise<string>;
  close(): void;
}

/**
 * 逐条问「复用还是重跑」,返回被选中复用的 selector(按传入顺序)。
 *
 * 默认是**重跑**:回车、空行、看不懂的输入都算「不采信」。授权是把风险显式交给人,
 * 手滑的方向必须是多花一次钱,不是静默采信一条可能已经不成立的旧判定。
 */
export async function promptAcceptSelections(
  choices: readonly AcceptChoice[],
  reader: PromptReader,
  write: (text: string) => void,
): Promise<string[]> {
  const chosen: string[] = [];
  for (const choice of choices) {
    const change = choice.from !== undefined || choice.to !== undefined
      ? `  ${choice.from ?? ""} → ${choice.to ?? ""}`.trimEnd()
      : "";
    write(`previous-result  ${choice.selector}${change}  (${choice.evals} evals)
`);
    // 读不到答案(管道 EOF、Ctrl+D)按「不采信」处理:交互被打断时的默认方向必须是多花一次钱,
    // 不是静默采信一条没人确认过的旧判定。
    const answer = (await reader.question(`  reuse these results? [y/N] `).catch(() => "")).trim().toLowerCase();
    if (answer === "y" || answer === "yes") chosen.push(choice.selector);
  }
  return chosen;
}

/**
 * 真 TTY 的 reader:问答走 stderr(人读通道),答案从 stdin 读。
 * 用 `node:readline/promises` —— 逐原因标记不值得引一个依赖进来。
 */
export function createStdinPromptReader(): PromptReader {
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  return {
    question: (prompt) => rl.question(prompt),
    close: () => rl.close(),
  };
}

/** 选完之后先打出的等价命令:可直接进 CI,也可以复述给同事。 */
export function equivalentAcceptCommand(command: string, selectors: readonly string[]): string {
  return [command, ...selectors.map((selector) => `--accept ${selector}`)].join(" ");
}
