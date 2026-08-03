// Landing page「Agent 反馈闭环」区块的终端帧数据。四帧对应闭环四步，
// 步骤标题/说明的 en/zh 文案在 lib/content.ts 的 loopSteps 里，组件按下标配对。
//
// 终端内容 en/zh 共用：CLI 输出本身不随语言本地化，示例保持一份避免行号与标注错位。
// 输出形态以 docs/feature/reports/show.md 及其分篇为准（handoff block、attempt 诊断
// 首页、--source 源码标注），示例数字是编排的演示值。

export type LoopLineKind = "cmd" | "pass" | "fail" | "dim" | "plain" | "blank";

export type LoopLine = {
  kind: LoopLineKind;
  text: string;
};

export type LoopFrame = {
  id: string;
  lines: LoopLine[];
};

const line = (kind: LoopLineKind, text = ""): LoopLine => ({ kind, text });

export const loopFrames: LoopFrame[] = [
  {
    id: "run",
    lines: [
      line("cmd", "$ niceeval exp local --output agent --force"),
      line("fail", "NICEEVAL RESULT failed"),
      line("plain", "summary: 14 passed, 1 failed, 0 errored"),
      line("plain", "failures:"),
      line("fail", "  - @1k2m9qtr weather/brooklyn [local]"),
      line("dim", "      gate: tool was never called"),
      line("plain", "next:"),
      line("dim", "  niceeval show @1k2m9qtr"),
      line("dim", "  niceeval show @1k2m9qtr --execution"),
    ],
  },
  {
    id: "show",
    lines: [
      line("cmd", "$ niceeval show @1k2m9qtr"),
      line("plain", "@1k2m9qtr · weather/brooklyn · local/codex-gpt-5.4 · failed"),
      line("dim", "attempt 2 · 41.2s · 12.3k tokens · $0.04"),
      line("blank"),
      line("plain", "failures:"),
      line("fail", "  gate · tool was never called"),
      line("dim", '    assertion: calledTool("get_weather")'),
      line("dim", "    source: evals/weather/brooklyn.eval.ts:12:5"),
      line("blank"),
      line("plain", "available:"),
      line("dim", "  niceeval show @1k2m9qtr --source"),
      line("dim", "  niceeval show @1k2m9qtr --execution"),
      line("dim", "  niceeval show @1k2m9qtr --timing"),
    ],
  },
  {
    id: "source",
    lines: [
      line("cmd", "$ niceeval show @1k2m9qtr --source"),
      line("plain", "10    async test(t) {"),
      line("plain", '11      const turn = await t.send("What\'s the weather in Brooklyn?");'),
      line("dim", "        turn1 · completed · 3.4s"),
      line("fail", '12✗     turn.calledTool("get_weather");'),
      line("dim", "        gate · tool was never called"),
      line("pass", "13✓     turn.succeeded();"),
      line("fail", '14✗     t.check(turn.message, judge("answer uses live data"));'),
      line("dim", "        soft · 0.2/1 · reply invents a temperature without any tool call"),
      line("plain", "15    },"),
      line("blank"),
      line("dim", "full failure detail: niceeval show @1k2m9qtr"),
    ],
  },
  // 优化这步的画面是 coding agent(Claude Code)在修用户自己的 bot:
  // 读 eval 的失败证据 → 说明发现了什么问题 → 改代码。重跑不在这帧——
  // 环回到评估,--force 重跑在评估那帧。
  {
    id: "converge",
    lines: [
      line("cmd", '$ claude "the weather/brooklyn eval failed — fix my bot"'),
      line("plain", "● Bash(niceeval show @1k2m9qtr --source)"),
      line("dim", '  └ 12✗ turn.calledTool("get_weather") · tool was never called'),
      line("plain", "● The eval found the bot answers weather without calling get_weather."),
      line("pass", "● Update(agents/my-agent.ts)"),
      line("dim", "  └ call get_weather before answering"),
      line("blank"),
      line("plain", "● Done — re-run the experiment to verify."),
    ],
  },
];
