// Landing page 的 eval 示例卡数据。每个示例自包含：meta(行号 -> 注解 key)对 en/zh 共用，
// 所以 en/zh 两份代码必须逐行对应——改任何一份的行数时，另一份和 meta.highlights 要一起改。
//
// 三种可点开的行：replyKeys 里的 key 是发送的消息(点开看这一轮 Session log)，其余是断言(点开看解释)。
// 新增示例只需要在这里加一个对象，组件与 i18n copy 不用动。

export type EvalExampleLocale = {
  label: string;
  tag: string;
  lines: string[];
  notes: Record<string, string>;
  traces: Record<string, EvalExampleTrace>;
  timingRows: Array<{ label: string; value: string }>;
  timingTotal: string;
};

export type EvalExampleTraceEvent = {
  lane: "input" | "model" | "tools";
  kind: string;
  summary: string;
  status: string;
  tool?: boolean;
  callPhase?: "started" | "finished";
  callId?: string;
  detail?: string;
  raw?: string;
};

export type EvalExampleTrace = {
  duration: string;
  calls: number;
  events: EvalExampleTraceEvent[];
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

const multiTurnImage: EvalExample = {
  id: "multi-turn-image",
  // 改编自 examples/zh/ai-sdk/evals/multi-turn-image.eval.ts
  meta: {
    gateBadge: "1/0.7",
    gateLine: 24,
    highlights: {
      8: "turn1",
      9: "succeeded",
      10: "noTools",
      11: "turn2",
      12: "recognize",
      13: "turn3",
      16: "followup",
      24: "gate",
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
      "  judge: true,",
      '  description: "Evaluate an agent\'s multimodal ability across a multi-turn conversation",',
      "",
      "  async test(t) {",
      '    const first = await t.sendFile("evals/sample.png", "What is in this image?");',
      "    await first.succeeded().orStop();",
      "    first.usedNoTools();",
      '    const second = await t.send("What color is the background?");',
      "    second.messageIncludes(/blue|white|square/i);",
      '    const third = await t.send("What color is the shape in the middle?");',
      "",
      '    await t.group("follow-ups stay grounded in the image context", () => {',
      "      t.messageIncludes(/white/i);",
      "    });",
      "",
      "    t.judge.autoevals",
      '      .closedQA("Does the assistant keep grounding every answer in the turn-one image, across all three turns, instead of making things up?", {',
      '        input: "A user asks about a blue image with a white square, then asks for its background and shape colors.",',
      "        output: [first.message, second.message, third.message].join(\"\\n\"),",
      "      })",
      "      .gate(0.7);",
      "  },",
      "});",
    ],
    notes: {
      succeeded: "await first.succeeded().orStop() confirms turn 1 went through cleanly and stops this eval before later assertions can read a failed or waiting turn.",
      noTools: "first.usedNoTools() passes only when turn 1's captured action evidence can prove there was no tool call; incomplete coverage becomes unavailable.",
      recognize: "second.messageIncludes() is a turn-scoped assertion — it only checks turn 2's own reply, unlike the run-level scan below.",
      followup: "This assertion runs at the run level — it scans every assistant message across all three turns, not just the last reply.",
      gate: "The root-level Judge receives explicit input and all three replies as output; the run only passes with a score at or above 0.7.",
    },
    traces: {
      turn1: { duration: "2.1s", calls: 0, events: [
        { lane: "input", kind: "user", summary: "What is in this image? · sample.png", status: "captured", detail: "What is in this image? Attached file: evals/sample.png", raw: "What is in this image?\n\n[attachment: evals/sample.png]" },
        { lane: "model", kind: "assistant", summary: "The image shows a blue background with a white square in the middle.", status: "captured", detail: "Assistant identifies the blue background and white square.", raw: "The image shows a blue background with a white square in the middle." },
      ] },
      turn2: { duration: "1.3s", calls: 0, events: [
        { lane: "input", kind: "user", summary: "What color is the background?", status: "captured", detail: "Follow-up question about the image background.", raw: "What color is the background?" },
        { lane: "model", kind: "assistant", summary: "The background is blue.", status: "captured", detail: "Assistant grounds the answer in the first-turn image.", raw: "The background is blue." },
      ] },
      turn3: { duration: "1.5s", calls: 0, events: [
        { lane: "input", kind: "user", summary: "What color is the shape in the middle?", status: "captured", detail: "Follow-up question about the center shape.", raw: "What color is the shape in the middle?" },
        { lane: "model", kind: "assistant", summary: "The shape in the middle is white.", status: "captured", detail: "Assistant grounds the answer in the first-turn image.", raw: "The shape in the middle is white." },
      ] },
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
      "  judge: true,",
      '  description: "评估 agent 在多轮对话中多模态的能力",',
      "",
      "  async test(t) {",
      '    const first = await t.sendFile("evals/sample.png", "这张图片里有什么？");',
      "    await first.succeeded().orStop();",
      "    first.usedNoTools();",
      '    const second = await t.send("图片里的背景是什么颜色？");',
      "    second.messageIncludes(/蓝|blue|白|方块|square/i);",
      '    const third = await t.send("中间那个形状是什么颜色的？");',
      "",
      '    await t.group("后续追问能联系图片上下文", () => {',
      "      t.messageIncludes(/白|white/i);",
      "    });",
      "",
      "    t.judge.autoevals",
      '      .closedQA("助手是否在三轮对话中始终基于第一轮发送的图片内容作答，而不是凭空发挥？", {',
      '        input: "用户先询问一张蓝底白色方块图片，再追问背景和中间形状的颜色。",',
      "        output: [first.message, second.message, third.message].join(\"\\n\"),",
      "      })",
      "      .gate(0.7);",
      "  },",
      "});",
    ],
    notes: {
      succeeded: "await first.succeeded().orStop() 确认第一轮收发正常；失败或停在人工介入(HITL)时，后续断言不会继续读取它。",
      noTools: "first.usedNoTools() 只会在第一轮已捕获的 action 证据足以证明没有工具调用时通过；覆盖不完整会得到 unavailable。",
      recognize: "second.messageIncludes() 是轮次级断言——只检查第二轮自己的回复，跟下面的 run 级扫描不一样。",
      followup: "这是 run 级断言——会扫描整次运行里所有 assistant 消息，而不只是最后一轮回复。",
      gate: "根级 Judge 明确接收输入和三轮回复；分数达到 0.7 才算通过。",
    },
    traces: {
      turn1: { duration: "2.1s", calls: 0, events: [
        { lane: "input", kind: "用户", summary: "这张图片里有什么？ · sample.png", status: "已捕获", detail: "这张图片里有什么？附件：evals/sample.png", raw: "这张图片里有什么？\n\n[附件：evals/sample.png]" },
        { lane: "model", kind: "助手", summary: "图片是一个蓝色背景，中间有一个白色方块。", status: "已捕获", detail: "助手识别出蓝色背景和白色方块。", raw: "图片是一个蓝色背景，中间有一个白色方块。" },
      ] },
      turn2: { duration: "1.3s", calls: 0, events: [
        { lane: "input", kind: "用户", summary: "图片里的背景是什么颜色？", status: "已捕获", detail: "追问图片背景的颜色。", raw: "图片里的背景是什么颜色？" },
        { lane: "model", kind: "助手", summary: "背景是蓝色。", status: "已捕获", detail: "助手基于第一轮图片回答。", raw: "背景是蓝色。" },
      ] },
      turn3: { duration: "1.5s", calls: 0, events: [
        { lane: "input", kind: "用户", summary: "中间那个形状是什么颜色的？", status: "已捕获", detail: "追问中间形状的颜色。", raw: "中间那个形状是什么颜色的？" },
        { lane: "model", kind: "助手", summary: "中间的形状是白色。", status: "已捕获", detail: "助手基于第一轮图片回答。", raw: "中间的形状是白色。" },
      ] },
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

const weatherTool: EvalExample = {
  id: "weather-tool",
  // 改编自 examples/zh/ai-sdk-v7/evals/weather-tool.eval.ts
  meta: {
    gateBadge: "1/0.7",
    gateLine: 24,
    highlights: {
      9: "turn1",
      12: "calledTool",
      13: "notCalledTool",
      14: "eventOrder",
      15: "message",
      17: "budget",
      24: "gate",
    },
    replyKeys: ["turn1"],
  },
  en: {
    label: "Weather via tool calls",
    tag: "tool calls",
    lines: [
      'import { defineEval } from "niceeval";',
      'import { eventMatch, jsonMatch, toolMatch } from "niceeval/expect";',
      "",
      "export default defineEval({",
      "  judge: true,",
      '  description: "Live weather must go through get_weather — no making it up",',
      "",
      "  async test(t) {",
      '    const turn = await t.send("What\'s the weather in Beijing today?");',
      "    await turn.succeeded().orStop();",
      "",
      '    t.calledTool(toolMatch("get_weather", { input: jsonMatch({ city: "Beijing" }) }));',
      '    t.notCalledTool("web_search");',
      '    t.eventOrder([eventMatch("operation.started"), eventMatch("operation.finished"), eventMatch("message")]);',
      "    t.messageIncludes(/°C|sunny|cloudy|rain/i);",
      "",
      '    await t.group("stays within budget", () => {',
      "      t.maxToolCalls(2);",
      "      t.maxCost(0.05);",
      "    });",
      "",
      "    turn.judge.autoevals",
      '      .closedQA("Did the assistant give concrete weather data instead of hedging?")',
      "      .gate(0.7);",
      "  },",
      "});",
    ],
    notes: {
      calledTool: "toolMatch() selects the get_weather occurrence and jsonMatch() checks its captured input, so this proves the agent really called it with city = Beijing rather than merely claiming it did.",
      notCalledTool: "This negative assertion passes only when the captured Turn evidence can prove there was no web_search call; incomplete coverage becomes unavailable rather than a false pass.",
      eventOrder: "eventOrder() checks the sequence: the tool call fired, the result came back, and only then did the user get an answer.",
      message: "The reply must show visible evidence of the weather data — calling the tool but never answering the user also fails.",
      budget: "Budget assertions cap tool calls and cost, so a passing run is also an affordable run.",
      gate: "A closedQA judge scores whether the answer contains concrete weather data; the run needs at least 0.7 to pass.",
    },
    traces: {
      turn1: { duration: "1.8s", calls: 1, events: [
        { lane: "input", kind: "user", summary: "What's the weather in Beijing today?", status: "captured", detail: "User asks for live weather in Beijing.", raw: "What's the weather in Beijing today?" },
        { lane: "tools", kind: "tool", summary: "get_weather({ city: \"Beijing\" })", status: "started", tool: true, callPhase: "started", callId: "weather-1", detail: "get_weather started with city = Beijing", raw: "{\n  \"name\": \"get_weather\",\n  \"input\": { \"city\": \"Beijing\" }\n}" },
        { lane: "tools", kind: "tool", summary: "get_weather result · sunny, 31°C, light breeze", status: "completed", tool: true, callPhase: "finished", callId: "weather-1", detail: "get_weather completed: sunny, 31°C, light breeze", raw: "{\n  \"condition\": \"sunny\",\n  \"temperatureC\": 31,\n  \"wind\": \"light breeze\"\n}" },
        { lane: "model", kind: "assistant", summary: "It's sunny in Beijing right now — around 31°C with a light breeze.", status: "captured", detail: "Assistant cites the returned weather data in its answer.", raw: "It's sunny in Beijing right now — around 31°C with a light breeze." },
      ] },
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
      'import { eventMatch, jsonMatch, toolMatch } from "niceeval/expect";',
      "",
      "export default defineEval({",
      "  judge: true,",
      '  description: "实时天气必须走 get_weather 工具，不许编造",',
      "",
      "  async test(t) {",
      '    const turn = await t.send("北京今天天气怎么样？");',
      "    await turn.succeeded().orStop();",
      "",
      '    t.calledTool(toolMatch("get_weather", { input: jsonMatch({ city: "北京" }) }));',
      '    t.notCalledTool("web_search");',
      '    t.eventOrder([eventMatch("operation.started"), eventMatch("operation.finished"), eventMatch("message")]);',
      "    t.messageIncludes(/°C|晴|多云|雨/);",
      "",
      '    await t.group("预算内完成", () => {',
      "      t.maxToolCalls(2);",
      "      t.maxCost(0.05);",
      "    });",
      "",
      "    turn.judge.autoevals",
      '      .closedQA("助手是否给出了具体的天气数据，而不是含糊其辞？")',
      "      .gate(0.7);",
      "  },",
      "});",
    ],
    notes: {
      calledTool: "toolMatch() 选中 get_weather occurrence，jsonMatch() 检查其中已捕获的 input；因此这里证明 agent 确实以 city = 北京 发起了调用，而不只是嘴上说调了。",
      notCalledTool: "负断言只会在当前 Turn 的已捕获证据足以证明没有 web_search 调用时通过；覆盖不完整会得到 unavailable，不会假通过。",
      eventOrder: "eventOrder() 检查事件序：先发起工具调用、拿到结果，然后才回复用户。",
      message: "回复里必须出现天气数据的可见证据——只调工具不回答用户也算失败。",
      budget: "预算断言限制工具调用次数和成本，通过的 run 同时也是省钱的 run。",
      gate: "closedQA judge 给「是否给出具体天气数据」打分，达到 0.7 才算通过。",
    },
    traces: {
      turn1: { duration: "1.8s", calls: 1, events: [
        { lane: "input", kind: "用户", summary: "北京今天天气怎么样？", status: "已捕获", detail: "用户询问北京的实时天气。", raw: "北京今天天气怎么样？" },
        { lane: "tools", kind: "工具", summary: "get_weather({ city: \"北京\" })", status: "已开始", tool: true, callPhase: "started", callId: "weather-1", detail: "get_weather 已开始，city = 北京", raw: "{\n  \"name\": \"get_weather\",\n  \"input\": { \"city\": \"北京\" }\n}" },
        { lane: "tools", kind: "工具", summary: "get_weather 结果 · 晴，31°C，微风", status: "已完成", tool: true, callPhase: "finished", callId: "weather-1", detail: "get_weather 已完成：晴，31°C，微风", raw: "{\n  \"condition\": \"晴\",\n  \"temperatureC\": 31,\n  \"wind\": \"微风\"\n}" },
        { lane: "model", kind: "助手", summary: "北京现在是晴天，气温约 31°C，微风。", status: "已捕获", detail: "助手把工具返回的天气数据写进回答。", raw: "北京现在是晴天，气温约 31°C，微风。" },
      ] },
    },
    timingRows: [
      { label: "第 1 轮 · send(提问)", value: "1.8s" },
      { label: "get_weather 工具调用", value: "0.4s" },
      { label: "judge.autoevals.closedQA", value: "0.8s" },
    ],
    timingTotal: "共 3.0s · 预估 $0.004",
  },
};

const sandboxArtifact: EvalExample = {
  id: "sandbox-artifact",
  // 改编自 https://github.com/CorrectRoadH/coding-agent-skill 的 evals/ponytail-csv-sum.eval.ts。
  // notes / timing 取自一次真实运行(claude-code+ponytail / claude-sonnet-4-6,
  // docker node:24,2026-07-03):agent Read CSV → Write sum_sales.py(csv.DictReader)
  // → python3 输出 351.0;judge closedQA 得 1 分;第 1 轮 16s,整个 attempt 51.4s / $0.296。
  meta: {
    gateBadge: "1/0.7",
    gateLine: 24,
    highlights: {
      8: "sandbox",
      10: "turn1",
      13: "fileChanged",
      16: "stdout",
      24: "gate",
    },
    replyKeys: ["turn1"],
  },
  en: {
    label: "Coding agent in a sandbox",
    tag: "sandbox",
    lines: [
      'import { defineEval } from "niceeval";',
      'import { pattern } from "niceeval/expect";',
      "",
      "export default defineEval({",
      "  judge: true,",
      '  description: "Ask a coding agent to sum a CSV column, then verify the artifact",',
      "",
      "  async test(t) {",
      '    await t.sandbox.writeText("sales.csv", "id,amount\\n1,100.5\\n2,200.0\\n3,50.5");',
      "",
      '    const turn = await t.send("Write sum_sales.py that prints the total of the amount column.");',
      "    await turn.succeeded().orStop();",
      "",
      '    t.sandbox.fileChanged("sum_sales.py");',
      "",
      '    const run = await t.sandbox.runCommandOrThrow("python3", ["sum_sales.py"]);',
      "    t.check(run.stdout.trim(), pattern(/^351(\\.0)?$/));",
      "",
      '    const code = await t.sandbox.readText("sum_sales.py");',
      "    t.judge.autoevals",
      '      .closedQA("Does the code use the csv stdlib instead of pandas, and stay concise?", {',
      '        input: "Review the generated source code for sum_sales.py.",',
      "        output: code,",
      "      })",
      "      .gate(0.7);",
      "  },",
      "});",
    ],
    notes: {
      sandbox: "The whole eval runs inside an isolated sandbox — writeText() seeded sales.csv with the two columns id and amount, and the agent's first move was to Read it.",
      fileChanged: "The agent really wrote sum_sales.py via the Write tool — 8 lines, csv.DictReader summing the amount column. t.sandbox.fileChanged() asserts that artifact, not the reply text.",
      stdout: "The graded evidence is real: python3 sum_sales.py printed `351.0` inside the sandbox, and /^351(\\.0)?$/ matched it.",
      gate: "The root-level closedQA Judge received the generated source explicitly and scored it 1 (threshold 0.7): csv stdlib, no pandas, 8 lines.",
    },
    traces: {
      turn1: { duration: "16s", calls: 3, events: [
        { lane: "input", kind: "user", summary: "Write sum_sales.py that prints the total of the amount column.", status: "captured", detail: "User asks for a Python program that sums the amount column.", raw: "Write sum_sales.py that prints the total of the amount column." },
        { lane: "tools", kind: "tool", summary: "Read sales.csv", status: "started", tool: true, callPhase: "started", callId: "read-sales-csv", detail: "Read started for sales.csv.", raw: "{\n  \"name\": \"Read\",\n  \"path\": \"sales.csv\"\n}" },
        { lane: "tools", kind: "tool", summary: "Read sales.csv", status: "completed", tool: true, callPhase: "finished", callId: "read-sales-csv", detail: "Read completed with the id and amount rows.", raw: "id,amount\n1,100.5\n2,200.0\n3,50.5" },
        { lane: "tools", kind: "tool", summary: "Write sum_sales.py", status: "started", tool: true, callPhase: "started", callId: "write-sum-sales", detail: "Write started for sum_sales.py.", raw: "{\n  \"name\": \"Write\",\n  \"path\": \"sum_sales.py\"\n}" },
        { lane: "tools", kind: "tool", summary: "Write sum_sales.py", status: "completed", tool: true, callPhase: "finished", callId: "write-sum-sales", detail: "Write completed with a csv.DictReader implementation.", raw: "import csv\n\nwith open(\"sales.csv\") as source:\n    print(sum(float(row[\"amount\"]) for row in csv.DictReader(source)))" },
        { lane: "tools", kind: "tool", summary: "python3 sum_sales.py", status: "started", tool: true, callPhase: "started", callId: "run-sum-sales", detail: "Command started in the sandbox workdir.", raw: "python3 sum_sales.py" },
        { lane: "tools", kind: "tool", summary: "python3 sum_sales.py · 351.0", status: "completed", tool: true, callPhase: "finished", callId: "run-sum-sales", detail: "Command completed with exit code 0 and stdout 351.0.", raw: "stdout:\n351.0\n\nstderr:\n\nexitCode: 0" },
        { lane: "model", kind: "assistant", summary: "Created sum_sales.py and verified that it outputs 351.0.", status: "captured", detail: "Assistant reports the generated file and its verified result.", raw: "Created sum_sales.py and verified that it outputs 351.0." },
      ] },
    },
    timingRows: [
      { label: "Turn 1 · send(task) · 3 tool calls", value: "16s" },
      { label: "sandbox start + agent setup + assertion evaluation", value: "35.4s" },
    ],
    timingTotal: "51.4s total · 68.6k tokens · $0.296",
  },
  zh: {
    label: "沙箱里的 coding agent",
    tag: "沙箱",
    lines: [
      'import { defineEval } from "niceeval";',
      'import { pattern } from "niceeval/expect";',
      "",
      "export default defineEval({",
      "  judge: true,",
      '  description: "让 coding agent 求和 CSV 列，然后验证产物与运行结果",',
      "",
      "  async test(t) {",
      '    await t.sandbox.writeText("sales.csv", "id,amount\\n1,100.5\\n2,200.0\\n3,50.5");',
      "",
      '    const turn = await t.send("写一个 sum_sales.py，打印 amount 列的总和。");',
      "    await turn.succeeded().orStop();",
      "",
      '    t.sandbox.fileChanged("sum_sales.py");',
      "",
      '    const run = await t.sandbox.runCommandOrThrow("python3", ["sum_sales.py"]);',
      "    t.check(run.stdout.trim(), pattern(/^351(\\.0)?$/));",
      "",
      '    const code = await t.sandbox.readText("sum_sales.py");',
      "    t.judge.autoevals",
      '      .closedQA("代码是否用 csv 标准库而非 pandas，并保持简洁？", {',
      '        input: "审阅生成的 sum_sales.py 源码。",',
      "        output: code,",
      "      })",
      "      .gate(0.7);",
      "  },",
      "});",
    ],
    notes: {
      sandbox: "整个 eval 在隔离沙箱里运行——writeText() 播种了 sales.csv（id 与 amount 两列），agent 的第一步就是 Read 它。",
      fileChanged: "agent 真的用 Write 工具写出了 sum_sales.py——8 行，csv.DictReader 累加 amount 列。t.sandbox.fileChanged() 断言的是这个产物，不是回复里的说法。",
      stdout: "评分证据是真实的：沙箱里 python3 sum_sales.py 打印出 `351.0`，/^351(\\.0)?$/ 匹配通过。",
      gate: "根级 closedQA Judge 明确接收生成的源码，并给它打了 1 分（阈值 0.7）：csv 标准库、没有 pandas、8 行。",
    },
    traces: {
      turn1: { duration: "16s", calls: 3, events: [
        { lane: "input", kind: "用户", summary: "写一个 sum_sales.py，打印 amount 列的总和。", status: "已捕获", detail: "用户要求写 Python 程序，求 amount 列的总和。", raw: "写一个 sum_sales.py，打印 amount 列的总和。" },
        { lane: "tools", kind: "工具", summary: "读取 sales.csv", status: "已开始", tool: true, callPhase: "started", callId: "read-sales-csv", detail: "开始读取 sales.csv。", raw: "{\n  \"name\": \"Read\",\n  \"path\": \"sales.csv\"\n}" },
        { lane: "tools", kind: "工具", summary: "读取 sales.csv", status: "已完成", tool: true, callPhase: "finished", callId: "read-sales-csv", detail: "读取完成，拿到 id 与 amount 的数据行。", raw: "id,amount\n1,100.5\n2,200.0\n3,50.5" },
        { lane: "tools", kind: "工具", summary: "写入 sum_sales.py", status: "已开始", tool: true, callPhase: "started", callId: "write-sum-sales", detail: "开始写入 sum_sales.py。", raw: "{\n  \"name\": \"Write\",\n  \"path\": \"sum_sales.py\"\n}" },
        { lane: "tools", kind: "工具", summary: "写入 sum_sales.py", status: "已完成", tool: true, callPhase: "finished", callId: "write-sum-sales", detail: "写入完成，使用 csv.DictReader。", raw: "import csv\n\nwith open(\"sales.csv\") as source:\n    print(sum(float(row[\"amount\"]) for row in csv.DictReader(source)))" },
        { lane: "tools", kind: "工具", summary: "python3 sum_sales.py", status: "已开始", tool: true, callPhase: "started", callId: "run-sum-sales", detail: "在 Sandbox 工作目录中开始执行命令。", raw: "python3 sum_sales.py" },
        { lane: "tools", kind: "工具", summary: "python3 sum_sales.py · 351.0", status: "已完成", tool: true, callPhase: "finished", callId: "run-sum-sales", detail: "命令以 exit code 0 完成，stdout 为 351.0。", raw: "stdout:\n351.0\n\nstderr:\n\nexitCode: 0" },
        { lane: "model", kind: "助手", summary: "已创建 sum_sales.py，并验证输出为 351.0。", status: "已捕获", detail: "助手报告生成的文件及已验证的结果。", raw: "已创建 sum_sales.py，并验证输出为 351.0。" },
      ] },
    },
    timingRows: [
      { label: "第 1 轮 · send(任务) · 3 次工具调用", value: "16s" },
      { label: "沙箱启动 + agent setup + 判分", value: "35.4s" },
    ],
    timingTotal: "共 51.4s · 68.6k tokens · $0.296",
  },
};

export const evalExamples: EvalExample[] = [multiTurnImage, weatherTool, sandboxArtifact];
