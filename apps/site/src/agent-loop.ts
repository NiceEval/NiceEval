// Landing page「Agent 反馈闭环」区块的终端帧数据。四帧对应闭环四步，
// 步骤标题/说明的 en/zh 文案在 lib/content.ts 的 loopSteps 里，组件按下标配对。
//
// 输出形态取自正式 CLI 契约：exp 的结束反馈见 docs/feature/experiments/cli/README.md「结束反馈与 receipt」，
// show 的 Attempt 概览与 --execution 见 docs/feature/inspection/cli.md「niceeval show」。
// locator 必须是合法格式：@1 加 12 位大写 Crockford base32。

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

const LOCATOR = "@1K1P0VJAPVJ12";
const RUN_ID = "8f3d6f62-1d34-4cf3-99c7-84ba3c483706";

export const loopFrames: LoopFrame[] = [
  {
    id: "run",
    lines: [
      line("cmd", "$ niceeval exp local"),
      line("fail", "FAILED                                                38s"),
      line("plain", "14 passed · 1 failed · 0 errored  (0 reused)"),
      line("blank"),
      line("plain", "FAILURES                                 1 failed attempt"),
      line("fail", `✗ ${LOCATOR}  weather/brooklyn  [local]`),
      line("dim", "  gate: get_weather was never called"),
      line("dim", `  details: niceeval show ${LOCATOR}`),
      line("blank"),
      line("plain", "NEXT"),
      line("dim", `  show: niceeval show --run ${RUN_ID}`),
      line("dim", `  view: niceeval view --run ${RUN_ID}`),
    ],
  },
  {
    id: "inspect",
    lines: [
      line("cmd", `$ niceeval show ${LOCATOR}`),
      line("plain", `Attempt ${LOCATOR}`),
      line("dim", "  Experiment  local"),
      line("dim", "  Eval        weather/brooklyn"),
      line("fail", "  Verdict     failed"),
      line("blank"),
      line("plain", "Assertions    available · 4 entries"),
      line("fail", "  ✗ gate  get_weather was never called"),
      line("blank"),
      line("plain", "Next"),
      line("dim", `  niceeval show ${LOCATOR} --execution`),
      line("dim", `  niceeval show ${LOCATOR} --source`),
    ],
  },
  {
    id: "evidence",
    lines: [
      line("cmd", `$ niceeval show ${LOCATOR} --execution`),
      line("plain", `Execution ${LOCATOR} · captured · complete`),
      line("blank"),
      line("plain", "  user: What's the weather in Brooklyn right now?"),
      line("plain", "  assistant: It's probably mild and partly cloudy in Brooklyn."),
      line("blank"),
      line("fail", "  0 tool calls · get_weather was available"),
      line("dim", "  end of trace"),
    ],
  },
  {
    id: "converge",
    lines: [
      line("cmd", '$ claude "weather/brooklyn failed — fix my bot"'),
      line("plain", `● Bash(niceeval show ${LOCATOR} --execution)`),
      line("dim", "  └ answered without calling get_weather"),
      line("plain", "● The bot guesses the weather instead of calling get_weather."),
      line("pass", "● Update(agents/my-agent.ts)"),
      line("dim", "  └ require get_weather for live weather questions"),
      line("plain", "● Bash(niceeval exp local weather/brooklyn)"),
      line("pass", "  └ PASSED · 1 passed · 0 failed · 0 errored"),
    ],
  },
];
