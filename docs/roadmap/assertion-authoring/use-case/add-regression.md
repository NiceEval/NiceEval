# 新增回归、先复现再修复

NiceEval-Eval 的 `add-regression` 题先要求 Agent 新增一条失败回归，再修业务实现并全量复验。
Assertion 重塑不能靠合并 Judge、删掉独立证据或改变得分分布换取短代码。

## 分值守恒

| Scope | 独立 Assertion | Points |
|---|---|---:|
| turn1 | 完整 experiment shell 已发起，status 故意省略 | 1 |
| turn1 | `show` shell completed | 1 |
| turn1 | experiment → show → assistant 非重叠顺序 | 1 |
| turn1 | 工具流程 Judge，binary | 2 |
| turn1 | 执行输出 Judge，binary | 3 |
| turn1 | 回复准确性 Judge，binary | 3 |
| turn1 | `succeeded()` | 1 |
| 新回归 | typed `t.require` 得到 exact-one path | 2 |
| 新回归 | 源码质量 Judge，binary | 3 |
| turn1 changes | 新文件出现在本轮边界 delta | 1 |
| turn2 | 完整 experiment shell completed | 1 |
| turn2 | experiment → assistant 非重叠顺序 | 1 |
| turn2 | 工具流程 Judge，binary | 2 |
| turn2 | 执行输出 Judge，binary | 3 |
| turn2 | 回复准确性 Judge，binary | 3 |
| 终态 | delayed file 与首次源码相等 | 2 |
| 终态 | 独立命令验证业务边界 | 3 |
| turn2 | `succeeded()` | 1 |

小计是 `12 + 6 + 10 + 6 = 34`。
18 行各自产生一条 `AssertionResult`；turn1 三条、源码一条、turn2 三条，共七条 Judge。

每条 Judge 使用 `scoreMode: "binary"`。
completed Decision 只能给 0 或 1，因此 `.points(n).gate()` 不会出现 failed 却仍挣部分分的情况。

## 完整写法

```ts
import { defineScoreEval } from "niceeval";
import { commandSucceeded, equals, satisfies } from "niceeval/expect";
import { material } from "niceeval/judge";

const EXISTING_EVALS = [
  "evals/policy/exchange.eval.ts",
  "evals/policy/privacy.eval.ts",
  "evals/policy/refund.eval.ts",
  "evals/policy/shipping.eval.ts",
  "evals/policy/warranty.eval.ts",
] as const;

type ExistingEval = (typeof EXISTING_EVALS)[number];

const NICEEVAL_LOCAL_COMMAND = /\bniceeval(?:@\S+)?\s+(?:--\s+)?exp\s+local\b/i;
const NICEEVAL_SHOW_COMMAND = /\bniceeval(?:@\S+)?\s+(?:--\s+)?show\b/i;

export default defineScoreEval({
  description: "给绿色 experiment 补一条真实回归，先复现再修实现并全量复验",
  tags: ["harness", "author", "regression", "multi-turn"],
  timeoutMs: 25 * 60 * 1000,
  diff: { ignore: [".niceeval/**"] },
  judge: {
    llm: {
      uses: {
        default: { media: ["text"] },
      },
    },
  },
  async test(t) {
    await t.sandbox.uploadDirectory(
      new URL("../../../fixtures/harness/add-regression/repo/", import.meta.url),
      ".",
    );

    const turn1 = await t.send(
      "客户报告：订单已经进入履约或出库后，policy agent 仍说可以取消。先把这个问题补成一条新的回归 eval，并在完整 local experiment 里实际跑出失败；暂时不要修业务实现。",
    );

    turn1
      .calledTool("shell", { input: { command: NICEEVAL_LOCAL_COMMAND } })
      .points(1)
      .gate();
    turn1
      .calledTool("shell", {
        input: { command: NICEEVAL_SHOW_COMMAND },
        status: "completed",
      })
      .points(1)
      .gate();
    turn1
      .eventOrder([
        { type: "tool", name: "shell", input: { command: NICEEVAL_LOCAL_COMMAND } },
        {
          type: "tool",
          name: "shell",
          input: { command: NICEEVAL_SHOW_COMMAND },
          status: "completed",
        },
        { type: "message", role: "assistant" },
      ])
      .label("先复现，再下钻，再回复")
      .points(1)
      .gate();

    const turn1Tools = material.json(turn1.toolCalls, {
      id: "turn1-tool-calls",
      role: "candidate",
    });
    turn1.judge
      .llm({
        name: "第一轮工具流程",
        rubric:
          "只判断本轮有序工具调用。必须确认助手以可分别观察的工具调用先运行非 dry-run 的完整 niceeval exp local，后使用 niceeval show 或带 locator 的等价 NiceEval 查看命令下钻新增失败；只读源码、只跑 dry-run、把两步藏进同一个 shell 调用或先猜结果后没有下钻都给 0，否则给 1。",
        scoreMode: "binary",
        on: turn1Tools,
      })
      .points(2)
      .gate();
    turn1.judge
      .llm({
        name: "第一轮运行结果",
        rubric:
          "只判断本轮 NiceEval 工具输出。必须由真实输出支持：完整 local 共 6 个 eval，5 passed、1 failed、0 errored；新增失败确实显示已经开始履约或出库的订单仍得到可取消答复。local 因预期中的 eval failed 返回失败状态不扣分。缺任一项给 0，否则给 1。",
        scoreMode: "binary",
        on: turn1Tools,
      })
      .points(3)
      .gate();
    turn1.judge
      .llm({
        name: "第一轮回复准确性",
        rubric:
          "只判断助手回复。必须准确说明：原有 5 道题没有检查该取消边界；新增后得到 5 passed、1 failed、0 errored；失败复现的是已经开始履约或出库的订单仍得到可取消答复；本轮只新增回归 eval、尚未修业务实现。缺任一项给 0，否则给 1。",
        scoreMode: "binary",
        on: material.text(turn1.message, {
          id: "turn1-reply",
          role: "candidate",
        }),
      })
      .points(3)
      .gate();
    turn1.succeeded().points(1).gate();

    const evalFilesResult = await t.sandbox.runCommand("find", [
      "evals/policy",
      "-type",
      "f",
      "-name",
      "*.eval.ts",
      "-print",
    ]);
    if (evalFilesResult.exitCode !== 0) {
      throw new Error(evalFilesResult.stderr || evalFilesResult.stdout);
    }
    const evalFiles = evalFilesResult.stdout
      .split("\n")
      .map((file) => file.trim().replace(/^\.\//, ""))
      .filter(Boolean);
    const newEvalFiles = evalFiles.filter(
      (file) => !EXISTING_EVALS.includes(file as ExistingEval),
    );
    const oneNewEval = satisfies(
      (files: readonly string[]): files is readonly [string] =>
        evalFiles.length === 6 && files.length === 1,
    ).label("恰好新增一条会被 local 选中的 policy eval");

    const [newEvalPath] = await t.require(newEvalFiles, oneNewEval, { points: 2 });

    const newEvalSource = await t.sandbox.readText(newEvalPath);
    turn1.judge
      .llm({
        name: "新增回归源码质量",
        rubric:
          "这份源码必须是一条非空、可执行的 NiceEval 回归 eval：它向 policy agent 提问已经开始履约或已经出库的订单是否还能取消，并用 gate 级断言拒绝当前错误的仍可取消行为、要求明确的不可取消语义；不能通过 skip、弱到无意义的断言、硬编码恒真值或改 experiment 来伪造失败。全部满足给 1，否则给 0。",
        scoreMode: "binary",
        on: material.text(newEvalSource, {
          id: "new-eval-source",
          role: "candidate",
        }),
      })
      .points(3)
      .gate();
    turn1.changes.fileChanged(newEvalPath).points(1);

    const candidateVersion = String(t.flags.candidateVersion);
    const fullRerunRule = candidateVersion.startsWith("0.9.")
      ? "候选是 0.9.x：修复后重新执行完整 local experiment 即可，不要求使用该版本没有的 rerun flag。"
      : "候选是 0.12+：业务源码不进入 eval fingerprint，工具调用证据必须体现强制全量重新执行，通常是 --rerun all，或语义等价的清除旧结果后全量运行；裸跑后携入旧结果不算复验。";
    const turn2 = await t.send("现在修业务实现，保留这条回归 eval，再全量确认一次。");

    turn2
      .calledTool("shell", {
        input: { command: NICEEVAL_LOCAL_COMMAND },
        status: "completed",
      })
      .points(1)
      .gate();
    turn2
      .eventOrder([
        {
          type: "tool",
          name: "shell",
          input: { command: NICEEVAL_LOCAL_COMMAND },
          status: "completed",
        },
        { type: "message", role: "assistant" },
      ])
      .label("复验完成后再回复")
      .points(1)
      .gate();

    const turn2Tools = material.json(turn2.toolCalls, {
      id: "turn2-tool-calls",
      role: "candidate",
    });
    turn2.judge
      .llm({
        name: "第二轮工具流程",
        rubric: `只判断本轮有序工具调用。必须确认助手先修改业务实现、保留回归 eval，随后运行完整 niceeval exp local。${fullRerunRule} 缺任一项给 0，否则给 1。`,
        scoreMode: "binary",
        on: turn2Tools,
      })
      .points(2)
      .gate();
    turn2.judge
      .llm({
        name: "第二轮运行结果",
        rubric:
          "只判断本轮 NiceEval 工具输出。必须由真实输出支持最终共 6 个 eval，6 passed、0 failed、0 errored。缺任一项给 0，否则给 1。",
        scoreMode: "binary",
        on: turn2Tools,
      })
      .points(3)
      .gate();
    turn2.judge
      .llm({
        name: "第二轮回复准确性",
        rubric:
          "只判断助手回复。必须准确说明修的是业务实现而不是削弱或删除回归 eval；最终共 6 个 eval，6 passed、0 failed、0 errored；并说明已经检查履约前可以取消、履约开始或出库后不可取消的边界。缺任一项给 0，否则给 1。",
        scoreMode: "binary",
        on: material.text(turn2.message, {
          id: "turn2-reply",
          role: "candidate",
        }),
      })
      .points(3)
      .gate();

    t.check(t.sandbox.file(newEvalPath), equals(newEvalSource))
      .label("修复轮原样保留新增的回归 eval")
      .points(2)
      .gate();

    const cancellationBehaviorTest = await t.sandbox.runCommand("node", [
      "--input-type=module",
      "-e",
      [
        'const { answerPolicyQuestion } = await import("./src/policy.ts");',
        'const before = answerPolicyQuestion("Can I cancel my order before fulfillment starts?");',
        'const shipped = answerPolicyQuestion("My order has already shipped. Can I cancel it?");',
        'const fulfilling = answerPolicyQuestion("Fulfillment has started. Can this order be canceled?");',
        'if (before !== "Orders may be canceled before fulfillment begins.") throw new Error(`before: ${before}`);',
        'if (shipped !== "Orders cannot be canceled after fulfillment begins.") throw new Error(`shipped: ${shipped}`);',
        'if (fulfilling !== "Orders cannot be canceled after fulfillment begins.") throw new Error(`fulfilling: ${fulfilling}`);',
      ].join("\n"),
    ]);
    t.check(cancellationBehaviorTest, commandSucceeded()).points(3).gate();
    turn2.succeeded().points(1).gate();
  },
});
```

## DX 变化

删掉的危险写法：

- 直接 boolean 配 `isTrue(label)`；
- `newEvalFiles[0]!`；
- Judge 调用点的 `JSON.stringify`；
- 未 await 的 `.stopOnFailure()`；
- attempt aggregate `t.sandbox.fileChanged(path)`；
- 终态检查前 eager `readText`，让候选删文件先变成 I/O error。

新增的概念都对应必要边界：

- labeled type predicate 与 Score `t.require(..., { points: 2 })` 同时负责收窄、给分和控制流；
- Eval 只声明一次 `judge.llm.uses`；
- `material.json` / `material.text` 固定每条 Judge 的最小材料；
- required Judge name 与 `scoreMode: "binary"` 固定标题和端点分数；
- `EventMatch` 表达有数据的非重叠顺序；
- `turn1.changes` 指明哪一轮产生新增文件；
- delayed file 把 missing 与读取 unavailable 分开。

示例里唯一 awaited Assertion control boundary 是 `t.require`。
其它 `await` 都是 send、文件或命令 I/O；没有浮空 `.stopOnFailure()`。
