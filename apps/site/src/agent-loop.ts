// Landing page「Agent 反馈闭环」区块的终端帧数据。四帧对应闭环四步，
// 步骤标题/说明的 en/zh 文案在 lib/content.ts 的 loopSteps 里，组件按下标配对。
//
// 机器调查通过固定 Query request；人需要连续阅读时在第一方 View 中打开同一 locator。

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
      line("dim", "  niceeval query discover"),
      line("dim", "  niceeval query run --request runs-list.json"),
    ],
  },
  {
    id: "inspect",
    lines: [
      line("cmd", "$ niceeval query discover"),
      line("plain", "fixed operations: runs.list · run.get · attempt.get · attempt.trace"),
      line("dim", "discover describes the protocol; it does not read a Record"),
      line("blank"),
      line("plain", "next:"),
      line("dim", "  niceeval query run --request runs-list.json"),
      line("dim", "  niceeval query run --request attempt.json"),
      line("blank"),
      line("plain", "human review:"),
      line("dim", "  niceeval view @1k2m9qtr"),
    ],
  },
  {
    id: "evidence",
    lines: [
      line("cmd", "$ niceeval query run --request attempt.json"),
      line("plain", "execute the selected fixed attempt.get request"),
      line("dim", "sealed attempt · weather/brooklyn · failed"),
      line("fail", "gate · tool was never called"),
      line("dim", "evidence: @1k2m9qtr"),
      line("pass", "follow-up: attempt.trace · attempt.sources"),
      line("blank"),
      line("dim", "open niceeval view @1k2m9qtr for human reading"),
    ],
  },
  {
    id: "converge",
    lines: [
      line("cmd", '$ claude "the weather/brooklyn eval failed — fix my bot"'),
      line("plain", "● Bash(niceeval query run --request attempt.json)"),
      line("dim", "  └ gate · tool was never called"),
      line("plain", "● The eval found the bot answers weather without calling get_weather."),
      line("pass", "● Update(agents/my-agent.ts)"),
      line("dim", "  └ call get_weather before answering"),
      line("blank"),
      line("plain", "● Done — re-run the experiment to verify."),
    ],
  },
];
