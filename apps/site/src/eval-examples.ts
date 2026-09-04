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
    gateLine: 23,
    highlights: {
      11: "turn1",
      12: "succeeded",
      13: "noTools",
      14: "turn2",
      15: "recognize",
      16: "turn3",
      19: "followup",
      23: "gate",
    },
    replyKeys: ["turn1", "turn2", "turn3"],
  },
  en: {
    label: "Multi-turn image Q&A",
    tag: "multimodal",
    lines: [
      'import { defineEval, defineJudge, judge } from "niceeval";',
      'import { pattern } from "niceeval/expect";',
      "",
      'const judging = defineJudge({ recipes: [judge.recipes.closedQA], material: { criterion: judge.referenceText({ name: "criterion", text: "Does the last reply stay grounded in the earlier image?" }) } });',
      "",
      "export default defineEval({",
      "  judge: judging,",
      '  description: "Evaluate an agent\'s multimodal ability across a multi-turn conversation",',
      "",
      "  async test(t) {",
      '    const first = await t.sendFile("evals/sample.png", "What is in this image?");',
      "    await first.succeeded().orStop();",
      "    first.usedNoTools();",
      '    const second = await t.send("What color is the background?");',
      "    t.check(second.message, pattern(/blue|white|square/i));",
      '    const third = await t.send("What color is the shape in the middle?");',
      "",
      '    await t.group("follow-ups stay grounded in the image context", () => {',
      "      t.check(third.message, pattern(/white/i));",
      "    });",
      "",
      "    const check = judge.check({ recipe: judging.recipes[0], material: { task: third.material.input, reply: third.material.reply, criterion: judging.material.criterion } });",
      "    third.check(check, judge.llm().atLeast(0.7)).gate();",
      "  },",
      "});",
    ],
    notes: {
      succeeded: "await first.succeeded().orStop() confirms turn 1 went through cleanly and stops this eval before later assertions can read a failed or waiting turn.",
      noTools: "first.usedNoTools() passes only when turn 1's captured action evidence can prove there was no tool call; incomplete coverage becomes unavailable.",
      recognize: "t.check(second.message, pattern(...)) checks only turn 2's reply, so a matching phrase in another turn cannot satisfy it.",
      followup: "t.check(third.message, pattern(...)) checks the final follow-up directly instead of relying on a cross-turn text scan.",
      gate: "The Judge binds the final Turn's managed input and reply views; the run only passes with a measurement at or above 0.7.",
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
      { label: "judge.llm", value: "0.9s" },
    ],
    timingTotal: "5.8s total · $0.006 est.",
  },
  zh: {
    label: "多轮看图问答",
    tag: "多模态",
    lines: [
      'import { defineEval, defineJudge, judge } from "niceeval";',
      'import { pattern } from "niceeval/expect";',
      "",
      'const judging = defineJudge({ recipes: [judge.recipes.closedQA], material: { criterion: judge.referenceText({ name: "criterion", text: "最后一轮回复是否基于先前图片？" }) } });',
      "",
      "export default defineEval({",
      "  judge: judging,",
      '  description: "评估 agent 在多轮对话中多模态的能力",',
      "",
      "  async test(t) {",
      '    const first = await t.sendFile("evals/sample.png", "这张图片里有什么？");',
      "    await first.succeeded().orStop();",
      "    first.usedNoTools();",
      '    const second = await t.send("图片里的背景是什么颜色？");',
      "    t.check(second.message, pattern(/蓝|blue|白|方块|square/i));",
      '    const third = await t.send("中间那个形状是什么颜色的？");',
      "",
      '    await t.group("后续追问能联系图片上下文", () => {',
      "      t.check(third.message, pattern(/白|white/i));",
      "    });",
      "",
      "    const check = judge.check({ recipe: judging.recipes[0], material: { task: third.material.input, reply: third.material.reply, criterion: judging.material.criterion } });",
      "    third.check(check, judge.llm().atLeast(0.7)).gate();",
      "  },",
      "});",
    ],
    notes: {
      succeeded: "await first.succeeded().orStop() 确认第一轮收发正常；失败或停在人工介入(HITL)时，后续断言不会继续读取它。",
      noTools: "first.usedNoTools() 只会在第一轮已捕获的 action 证据足以证明没有工具调用时通过；覆盖不完整会得到 unavailable。",
      recognize: "t.check(second.message, pattern(...)) 只检查第 2 轮回复，别的 Turn 出现匹配词也不能让它通过。",
      followup: "t.check(third.message, pattern(...)) 直接检查最后一次追问的回复，不依赖跨 Turn 文本扫描。",
      gate: "Judge 绑定最后一个 Turn 的受管输入和回复 View；Measurement 达到 0.7 才算通过。",
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
      { label: "judge.llm", value: "0.9s" },
    ],
    timingTotal: "共 5.8s · 预估 $0.006",
  },
};

const weatherTool: EvalExample = {
  id: "weather-tool",
  // 改编自 examples/zh/ai-sdk-v7/evals/weather-tool.eval.ts
  meta: {
    gateBadge: "1/0.7",
    gateLine: 25,
    highlights: {
      11: "turn1",
      14: "calledTool",
      15: "notCalledTool",
      16: "eventOrder",
      17: "message",
      19: "budget",
      25: "gate",
    },
    replyKeys: ["turn1"],
  },
  en: {
    label: "Weather via tool calls",
    tag: "tool calls",
    lines: [
      'import { defineEval, defineJudge, judge } from "niceeval";',
      'import { eventMatch, jsonMatch, pattern, toolMatch } from "niceeval/expect";',
      "",
      'const judging = defineJudge({ recipes: [judge.recipes.closedQA], material: { criterion: judge.referenceText({ name: "criterion", text: "Did the assistant give concrete weather data instead of hedging?" }) } });',
      "",
      "export default defineEval({",
      "  judge: judging,",
      '  description: "Live weather must go through get_weather — no making it up",',
      "",
      "  async test(t) {",
      '    const turn = await t.send("What\'s the weather in Beijing today?");',
      "    await turn.succeeded().orStop();",
      "",
      '    t.calledTool(toolMatch("get_weather", { input: jsonMatch({ city: "Beijing" }) }));',
      '    t.notCalledTool("web_search");',
      '    turn.eventOrder([eventMatch("operation.started"), eventMatch("operation.finished"), eventMatch("message", { role: "assistant" })]);',
      "    t.check(turn.message, pattern(/°C|sunny|cloudy|rain/i));",
      "",
      '    await t.group("stays within budget", () => {',
      "      t.maxToolCalls(2);",
      "      t.maxCost(0.05);",
      "    });",
      "",
      "    const check = judge.check({ recipe: judging.recipes[0], material: { task: turn.material.input, reply: turn.material.reply, criterion: judging.material.criterion } });",
      "    turn.check(check, judge.llm().atLeast(0.7)).gate();",
      "  },",
      "});",
    ],
    notes: {
      calledTool: "toolMatch() selects the get_weather occurrence and jsonMatch() checks its captured input, so this proves the agent really called it with city = Beijing rather than merely claiming it did.",
      notCalledTool: "This negative assertion passes only when the captured Turn evidence can prove there was no web_search call; incomplete coverage becomes unavailable rather than a false pass.",
      eventOrder: "turn.eventOrder() checks this Turn's sequence: the tool call fired, the result came back, and only then did the assistant answer.",
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
      { label: "judge.llm", value: "0.8s" },
    ],
    timingTotal: "3.0s total · $0.004 est.",
  },
  zh: {
    label: "天气工具调用",
    tag: "工具调用",
    lines: [
      'import { defineEval, defineJudge, judge } from "niceeval";',
      'import { eventMatch, jsonMatch, pattern, toolMatch } from "niceeval/expect";',
      "",
      'const judging = defineJudge({ recipes: [judge.recipes.closedQA], material: { criterion: judge.referenceText({ name: "criterion", text: "助手是否给出了具体的天气数据，而不是含糊其辞？" }) } });',
      "",
      "export default defineEval({",
      "  judge: judging,",
      '  description: "实时天气必须走 get_weather 工具，不许编造",',
      "",
      "  async test(t) {",
      '    const turn = await t.send("北京今天天气怎么样？");',
      "    await turn.succeeded().orStop();",
      "",
      '    t.calledTool(toolMatch("get_weather", { input: jsonMatch({ city: "北京" }) }));',
      '    t.notCalledTool("web_search");',
      '    turn.eventOrder([eventMatch("operation.started"), eventMatch("operation.finished"), eventMatch("message", { role: "assistant" })]);',
      "    t.check(turn.message, pattern(/°C|晴|多云|雨/));",
      "",
      '    await t.group("预算内完成", () => {',
      "      t.maxToolCalls(2);",
      "      t.maxCost(0.05);",
      "    });",
      "",
      "    const check = judge.check({ recipe: judging.recipes[0], material: { task: turn.material.input, reply: turn.material.reply, criterion: judging.material.criterion } });",
      "    turn.check(check, judge.llm().atLeast(0.7)).gate();",
      "  },",
      "});",
    ],
    notes: {
      calledTool: "toolMatch() 选中 get_weather occurrence，jsonMatch() 检查其中已捕获的 input；因此这里证明 agent 确实以 city = 北京 发起了调用，而不只是嘴上说调了。",
      notCalledTool: "负断言只会在当前 Turn 的已捕获证据足以证明没有 web_search 调用时通过；覆盖不完整会得到 unavailable，不会假通过。",
      eventOrder: "turn.eventOrder() 检查这一轮事件序：先发起工具调用、拿到结果，然后才由助手回复。",
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
      { label: "judge.llm", value: "0.8s" },
    ],
    timingTotal: "共 3.0s · 预估 $0.004",
  },
};

const sandboxArtifact: EvalExample = {
  id: "sandbox-artifact",
  // 改编自 https://github.com/CorrectRoadH/coding-agent-skill 的 evals/ponytail-csv-sum.eval.ts。
  // notes / timing 取自一次真实运行(claude-code+ponytail / claude-sonnet-4-6,
  // docker node:24,2026-07-03):agent Read CSV → Write sum_sales.py(csv.DictReader)
  // → python3 输出 351.0；第 1 轮 16s，整个 Attempt 51.4s / $0.296。
  meta: {
    gateBadge: "matched",
    gateLine: 15,
    highlights: {
      7: "sandbox",
      9: "turn1",
      12: "fileChanged",
      15: "stdout",
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
      "  },",
      "});",
    ],
    notes: {
      sandbox: "The whole eval runs inside an isolated sandbox — writeText() seeded sales.csv with the two columns id and amount, and the agent's first move was to Read it.",
      fileChanged: "The agent really wrote sum_sales.py via the Write tool — 8 lines, csv.DictReader summing the amount column. t.sandbox.fileChanged() asserts that artifact, not the reply text.",
      stdout: "The graded evidence is real: python3 sum_sales.py printed `351.0` inside the sandbox, and /^351(\\.0)?$/ matched it.",
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
      "  },",
      "});",
    ],
    notes: {
      sandbox: "整个 eval 在隔离沙箱里运行——writeText() 播种了 sales.csv（id 与 amount 两列），agent 的第一步就是 Read 它。",
      fileChanged: "agent 真的用 Write 工具写出了 sum_sales.py——8 行，csv.DictReader 累加 amount 列。t.sandbox.fileChanged() 断言的是这个产物，不是回复里的说法。",
      stdout: "评分证据是真实的：沙箱里 python3 sum_sales.py 打印出 `351.0`，/^351(\\.0)?$/ 匹配通过。",
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
