// Landing page 的 eval 示例卡数据。每个示例自包含：meta(行号 -> 注解 key)对 en/zh 共用，
// 所以 en/zh 两份代码必须逐行对应——改任何一份的行数时，另一份和 meta.highlights 要一起改。
//
// 三种可点开的行：replyKeys 里的 key 是发送的消息(点开看模拟回复)，其余是断言(点开看解释)。
// 新增示例只需要在这里加一个对象，组件与 i18n copy 不用动。

export type EvalExampleLocale = {
  label: string;
  tag: string;
  lines: string[];
  notes: Record<string, string>;
  timingRows: Array<{ label: string; value: string }>;
  timingTotal: string;
};

export type EvalExample = {
  id: string;
  meta: {
    gateBadge: string;
    gateLine: number;
    highlights: Record<number, string>;
    replyKeys: string[];
  };
  en: EvalExampleLocale;
  zh: EvalExampleLocale;
};

const multiTurnImage = {
  id: "multi-turn-image",
  // 改编自 examples/zh/ai-sdk/evals/multi-turn-image.eval.ts
  meta: {
    gateBadge: "1/0.7",
    gateLine: 20,
    highlights: {
      7: "turn1",
      8: "succeeded",
      9: "noTools",
      10: "turn2",
      11: "recognize",
      12: "turn3",
      15: "followup",
      20: "gate",
    },
    replyKeys: ["turn1", "turn2", "turn3"],
  },
  en: {
    label: "Multi-turn image Q&A",
    tag: "multimodal",
    lines: [
      'import { defineEval } from "niceeval";',
      "",
      "export default defineEval({",
      '  description: "Evaluate an agent\'s multimodal ability across a multi-turn conversation",',
      "",
      "  async test(t) {",
      '    const first = await t.sendFile("evals/sample.png", "What is in this image?");',
      "    t.succeeded();",
      "    first.usedNoTools();",
      '    const second = await t.send("What color is the background?");',
      "    second.messageIncludes(/blue|white|square/i);",
      '    await t.send("What color is the shape in the middle?");',
      "",
      '    await t.group("follow-ups stay grounded in the image context", () => {',
      "      t.messageIncludes(/white/i);",
      "    });",
      "",
      "    t.judge.autoevals",
      '      .closedQA("Does the assistant keep grounding every answer in the turn-one image, across all three turns, instead of making things up?")',
      "      .gate(0.7);",
      "  },",
      "});",
    ],
    notes: {
      turn1: "The image shows a blue background with a white square in the middle.",
      turn2: "The background is blue.",
      turn3: "The shape in the middle is white.",
      succeeded: "succeeded() confirms turn 1 went through cleanly — no failures and no stall waiting on a human-in-the-loop prompt.",
      noTools: "first.usedNoTools() confirms turn 1 answered straight from the image — no tool call was needed.",
      recognize: "second.messageIncludes() is a turn-scoped assertion — it only checks turn 2's own reply, unlike the run-level scan below.",
      followup: "This assertion runs at the run level — it scans every assistant message across all three turns, not just the last reply.",
      gate: "A closedQA judge checks whether the assistant kept grounding every answer in turn one's image; the run only passes with a score at or above 0.7.",
    },
    timingRows: [
      { label: "Turn 1 · sendFile(image)", value: "2.1s" },
      { label: "Turn 2 · send(follow-up)", value: "1.3s" },
      { label: "Turn 3 · send(follow-up)", value: "1.5s" },
      { label: "judge.autoevals.closedQA", value: "0.9s" },
    ],
    timingTotal: "5.8s total · $0.006 est.",
  },
  zh: {
    label: "多轮看图问答",
    tag: "多模态",
    lines: [
      'import { defineEval } from "niceeval";',
      "",
      "export default defineEval({",
      '  description: "评估 agent 在多轮对话中多模态的能力",',
      "",
      "  async test(t) {",
      '    const first = await t.sendFile("evals/sample.png", "这张图片里有什么？");',
      "    t.succeeded();",
      "    first.usedNoTools();",
      '    const second = await t.send("图片里的背景是什么颜色？");',
      "    second.messageIncludes(/蓝|blue|白|方块|square/i);",
      '    await t.send("中间那个形状是什么颜色的？");',
      "",
      '    await t.group("后续追问能联系图片上下文", () => {',
      "      t.messageIncludes(/白|white/i);",
      "    });",
      "",
      "    t.judge.autoevals",
      '      .closedQA("助手是否在三轮对话中始终基于第一轮发送的图片内容作答，而不是凭空发挥？")',
      "      .gate(0.7);",
      "  },",
      "});",
    ],
    notes: {
      turn1: "图片是一个蓝色背景，中间有一个白色方块。",
      turn2: "背景是蓝色。",
      turn3: "中间的形状是白色。",
      succeeded: "succeeded() 确认第一轮收发正常，没有失败，也没有卡在人工介入(HITL)。",
      noTools: "first.usedNoTools() 确认第一轮是直接看图作答，没有调用任何工具。",
      recognize: "second.messageIncludes() 是轮次级断言——只检查第二轮自己的回复，跟下面的 run 级扫描不一样。",
      followup: "这是 run 级断言——会扫描整次运行里所有 assistant 消息，而不只是最后一轮回复。",
      gate: "closedQA judge 检查助手是否全程都基于第一轮的图片作答；分数达到 0.7 才算通过。",
    },
    timingRows: [
      { label: "第 1 轮 · sendFile(图片)", value: "2.1s" },
      { label: "第 2 轮 · send(追问)", value: "1.3s" },
      { label: "第 3 轮 · send(追问)", value: "1.5s" },
      { label: "judge.autoevals.closedQA", value: "0.9s" },
    ],
    timingTotal: "共 5.8s · 预估 $0.006",
  },
};

const weatherTool = {
  id: "weather-tool",
  // 改编自 examples/zh/ai-sdk-v7/evals/weather-tool.eval.ts
  meta: {
    gateBadge: "1/0.7",
    gateLine: 22,
    highlights: {
      7: "turn1",
      10: "calledTool",
      11: "notCalledTool",
      12: "eventOrder",
      13: "message",
      15: "budget",
      22: "gate",
    },
    replyKeys: ["turn1"],
  },
  en: {
    label: "Weather via tool calls",
    tag: "tool calls",
    lines: [
      'import { defineEval } from "niceeval";',
      "",
      "export default defineEval({",
      '  description: "Live weather must go through get_weather — no making it up",',
      "",
      "  async test(t) {",
      '    const turn = await t.send("What\'s the weather in Beijing today?");',
      "    turn.expectOk();",
      "",
      '    t.calledTool("get_weather", { input: { city: "Beijing" } });',
      '    t.notCalledTool("web_search");',
      '    t.eventOrder(["action.called", "action.result", "message"]);',
      "    t.messageIncludes(/°C|sunny|cloudy|rain/i);",
      "",
      '    await t.group("stays within budget", () => {',
      "      t.maxToolCalls(2);",
      "      t.maxCost(0.05);",
      "    });",
      "",
      "    t.judge.autoevals",
      '      .closedQA("Did the assistant give concrete weather data instead of hedging?")',
      "      .atLeast(0.7);",
      "  },",
      "});",
    ],
    notes: {
      turn1: "It's sunny in Beijing right now — around 31°C with a light breeze.",
      calledTool: "calledTool() asserts the agent actually invoked get_weather with the right arguments — not just claimed it did.",
      notCalledTool: "Negative assertions are trustworthy because the adapter reports the full event stream — no silent web_search fallback slips through.",
      eventOrder: "eventOrder() checks the sequence: the tool call fired, the result came back, and only then did the user get an answer.",
      message: "The reply must show visible evidence of the weather data — calling the tool but never answering the user also fails.",
      budget: "Budget assertions cap tool calls and cost, so a passing run is also an affordable run.",
      gate: "A closedQA judge scores whether the answer contains concrete weather data; the run needs at least 0.7 to pass.",
    },
    timingRows: [
      { label: "Turn 1 · send(question)", value: "1.8s" },
      { label: "get_weather tool call", value: "0.4s" },
      { label: "judge.autoevals.closedQA", value: "0.8s" },
    ],
    timingTotal: "3.0s total · $0.004 est.",
  },
  zh: {
    label: "天气工具调用",
    tag: "工具调用",
    lines: [
      'import { defineEval } from "niceeval";',
      "",
      "export default defineEval({",
      '  description: "实时天气必须走 get_weather 工具，不许编造",',
      "",
      "  async test(t) {",
      '    const turn = await t.send("北京今天天气怎么样？");',
      "    turn.expectOk();",
      "",
      '    t.calledTool("get_weather", { input: { city: "北京" } });',
      '    t.notCalledTool("web_search");',
      '    t.eventOrder(["action.called", "action.result", "message"]);',
      "    t.messageIncludes(/°C|晴|多云|雨/);",
      "",
      '    await t.group("预算内完成", () => {',
      "      t.maxToolCalls(2);",
      "      t.maxCost(0.05);",
      "    });",
      "",
      "    t.judge.autoevals",
      '      .closedQA("助手是否给出了具体的天气数据，而不是含糊其辞？")',
      "      .atLeast(0.7);",
      "  },",
      "});",
    ],
    notes: {
      turn1: "北京现在是晴天，气温约 31°C，微风。",
      calledTool: "calledTool() 断言 agent 真的以正确参数调用了 get_weather，而不是嘴上说调了。",
      notCalledTool: "负断言之所以可信，是因为 adapter 上报了完整事件流——不存在偷偷走 web_search 的情况。",
      eventOrder: "eventOrder() 检查事件序：先发起工具调用、拿到结果，然后才回复用户。",
      message: "回复里必须出现天气数据的可见证据——只调工具不回答用户也算失败。",
      budget: "预算断言限制工具调用次数和成本，通过的 run 同时也是省钱的 run。",
      gate: "closedQA judge 给「是否给出具体天气数据」打分，达到 0.7 才算通过。",
    },
    timingRows: [
      { label: "第 1 轮 · send(提问)", value: "1.8s" },
      { label: "get_weather 工具调用", value: "0.4s" },
      { label: "judge.autoevals.closedQA", value: "0.8s" },
    ],
    timingTotal: "共 3.0s · 预估 $0.004",
  },
};

const sandboxArtifact = {
  id: "sandbox-artifact",
  // 改编自 https://github.com/CorrectRoadH/coding-agent-skill 的 evals/ponytail-csv-sum.eval.ts。
  // notes / timing 取自一次真实运行(claude-code+ponytail / claude-sonnet-4-6,
  // docker node:24,2026-07-03):agent Read CSV → Write sum_sales.py(csv.DictReader)
  // → python3 输出 351.0;judge closedQA 得 1 分;第 1 轮 16s,整个 attempt 51.4s / $0.296。
  meta: {
    gateBadge: "1/0.7",
    gateLine: 21,
    highlights: {
      8: "sandbox",
      10: "turn1",
      13: "fileChanged",
      16: "stdout",
      21: "gate",
    },
    replyKeys: ["turn1"],
  },
  en: {
    label: "Coding agent in a sandbox",
    tag: "sandbox",
    lines: [
      'import { defineEval } from "niceeval";',
      'import { includes } from "niceeval/expect";',
      "",
      "export default defineEval({",
      '  description: "Ask a coding agent to sum a CSV column, then verify the artifact",',
      "",
      "  async test(t) {",
      '    await t.sandbox.writeFiles({ "sales.csv": "id,amount\\n1,100.5\\n2,200.0\\n3,50.5" });',
      "",
      '    const turn = await t.send("Write sum_sales.py that prints the total of the amount column.");',
      "    turn.expectOk();",
      "",
      '    t.fileChanged("sum_sales.py");',
      "",
      '    const run = await t.sandbox.runCommand("python3", ["sum_sales.py"]);',
      "    t.check(run.stdout.trim(), includes(/^351(\\.0)?$/));",
      "",
      '    const code = await t.sandbox.readFile("sum_sales.py");',
      "    t.judge.autoevals",
      '      .closedQA("Does the code use the csv stdlib instead of pandas, and stay concise?", { on: code })',
      "      .atLeast(0.7);",
      "  },",
      "});",
    ],
    notes: {
      sandbox: "The whole eval runs inside an isolated sandbox — writeFiles() seeded sales.csv, and the agent's first move was to Read it (id, product, amount).",
      turn1: "Output `351.0` — 100.5 + 200.0 + 50.5.",
      fileChanged: "The agent really wrote sum_sales.py via the Write tool — 8 lines, csv.DictReader summing the amount column. fileChanged() asserts that artifact, not the reply text.",
      stdout: "The graded evidence is real: python3 sum_sales.py printed `351.0` inside the sandbox, and /^351(\\.0)?$/ matched it.",
      gate: "The closedQA judge scored the generated source 1 (threshold 0.7): csv stdlib, no pandas, 8 lines.",
    },
    timingRows: [
      { label: "Turn 1 · send(task) · 4 tool calls", value: "16s" },
      { label: "sandbox start + agent setup + scoring", value: "35.4s" },
    ],
    timingTotal: "51.4s total · 68.6k tokens · $0.296",
  },
  zh: {
    label: "沙箱里的 coding agent",
    tag: "沙箱",
    lines: [
      'import { defineEval } from "niceeval";',
      'import { includes } from "niceeval/expect";',
      "",
      "export default defineEval({",
      '  description: "让 coding agent 求和 CSV 列，然后验证产物与运行结果",',
      "",
      "  async test(t) {",
      '    await t.sandbox.writeFiles({ "sales.csv": "id,amount\\n1,100.5\\n2,200.0\\n3,50.5" });',
      "",
      '    const turn = await t.send("写一个 sum_sales.py，打印 amount 列的总和。");',
      "    turn.expectOk();",
      "",
      '    t.fileChanged("sum_sales.py");',
      "",
      '    const run = await t.sandbox.runCommand("python3", ["sum_sales.py"]);',
      "    t.check(run.stdout.trim(), includes(/^351(\\.0)?$/));",
      "",
      '    const code = await t.sandbox.readFile("sum_sales.py");',
      "    t.judge.autoevals",
      '      .closedQA("代码是否用 csv 标准库而非 pandas，并保持简洁？", { on: code })',
      "      .atLeast(0.7);",
      "  },",
      "});",
    ],
    notes: {
      sandbox: "整个 eval 在隔离沙箱里运行——writeFiles() 播种了 sales.csv，agent 的第一步就是 Read 它（id、product、amount 三列）。",
      turn1: "输出 `351.0` — 100.5 + 200.0 + 50.5。",
      fileChanged: "agent 真的用 Write 工具写出了 sum_sales.py——8 行，csv.DictReader 累加 amount 列。fileChanged() 断言的是这个产物，不是回复里的说法。",
      stdout: "评分证据是真实的：沙箱里 python3 sum_sales.py 打印出 `351.0`，/^351(\\.0)?$/ 匹配通过。",
      gate: "closedQA judge 给生成的源码打了 1 分（阈值 0.7）：csv 标准库、没有 pandas、8 行。",
    },
    timingRows: [
      { label: "第 1 轮 · send(任务) · 4 次工具调用", value: "16s" },
      { label: "沙箱启动 + agent setup + 判分", value: "35.4s" },
    ],
    timingTotal: "共 51.4s · 68.6k tokens · $0.296",
  },
};

export const evalExamples: EvalExample[] = [multiTurnImage, weatherTool, sandboxArtifact];
