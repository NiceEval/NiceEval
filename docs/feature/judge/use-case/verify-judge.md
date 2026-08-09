# Judge：接上兼容网关并确认真实判分

## 解决什么问题

judge 是唯一一个「配错了也能看起来跑通」的评分机制:被测 agent 照常跑、断言照常出现在报告里,只有分数是假的。
判分端点连不上、网关拒了鉴权、响应取不出分数——这些都不是 agent 的问题,却会落在 agent 的成绩单上。
这条路径要的是**每次都能回答「这批分数是不是真的评出来的」**,而不是靠盯着分数像不像话来猜。

## 全流程

1. 端点和模型是配置，写进代码；key 是凭据，只从进程变量来（契约见 [LLM-as-judge · 模型与鉴权](../library.md#模型与鉴权)）：

   ```ts
   // niceeval.config.ts
   export default defineConfig({
     judge: { model: "gpt-5.4-mini", baseUrl: "https://gateway.example.com/v1", apiKeyEnv: "MY_GATEWAY_KEY" },
   });
   ```

   **接兼容网关时 `baseUrl` 必须显式写。**
   只配 key 不配 `baseUrl`,niceeval 打的是官方端点 `https://api.openai.com/v1`。
   此时网关凭据会被发到 OpenAI，返回「Incorrect API key provided」。
   这看上去像 key 过期，实际是端点选错了。

2. 先跑一个只评固定文本的轻量验证 eval。
   配置 Judge 本身不会联网；[判分预检](../library.md#派发前预检)在派发前验证端点连通与鉴权，但「响应里真的取得出分数」只有执行一条 judge assertion 才知道，因此验证用例不需要先调用被测 agent：

   ```ts
   export default defineEval({
     async test(t) {
       t.judge.autoevals.closedQA("这段文本是否表达成功?", {
         on: "operation completed successfully",
       }).gate(0.8);
     },
   });
   ```

   ```bash
   niceeval exp judge-smoke
   ```

3. 调用失败会落成 `judge-call-failed`，`evidence` 与 `fix:` 同时写出实际求值的端点和 key 变量名：

   ```text
   unavailable: judge-call-failed: 401 from https://api.openai.com/v1 (Incorrect API key provided)
     fix: baseUrl 省略时用官方端点;接兼容网关请在 judge.baseUrl 显式写出地址,key 走 judge.apiKeyEnv 指定的变量(默认 NICEEVAL_JUDGE_KEY)
   ```

4. 跑通后确认分数**真的**评出来了:

   ```bash
   niceeval show <eval-id>
   ```

   **你会看到**:每条 rubric 后面跟着分数。
   跑中判分请求失败（网关回 400、连接断、超时）的那条不会伪装成 0 分通过。
   它记 `◌ unavailable · judge-call-failed`，`evidence` 里是状态码或异常摘要，并形成这次 Attempt 的 `errored` Verdict Claim。
   Attempt lifecycle 不使用 verdict token。
   **「裁判失败」和「agent 答得一塌糊涂」在报告上长得不一样**,这正是这套条目方式存在的理由：前者去修配置，后者去修 agent。

5. 确实允许某条 rubric 缺席(实验性的、没 key 的开发机上也要能跑)时,在那一条上显式声明:

   ```ts
   t.judge.autoevals.closedQA("文风是否友好?").optional();
   ```

   **你会看到**:它评不了时只留一条 unavailable Assertion Claim，不再形成 `errored` Verdict Claim；其余没写 `.optional()` 的 rubric 照旧要求可评估。

## 边界

- 端点整体不可达（连不上、鉴权被拒、探测超时）在派发前就被判分预检拦下。
  含 judge 断言的 eval 保持 `unstarted`，失败作为 Run-scoped `judge-precheck-failed` 执行错误 Observation 留档。
  不伪造逐条 Attempt 或 `errored` Verdict Claim，其余 eval 照常派发。
  本用例补的是预检涵盖不到的那段——协议不符、分数取不出来,只有真评一次才暴露。
- 允许缺席是**逐条断言的作者决定**,不是框架的全局降级策略；未写 `.optional()` 的 unavailable 仍形成 `errored` Verdict Claim，不会造出「一条都没评却全绿」的报告。
- `--strict` 不改变这条路径上的任何判定:unavailable 形成 `errored` Verdict Claim，与 soft 阈值是两回事(见[`--strict`](../../verdict/use-case/strict-quality-gate.md))。
- 模型找不到是另一个 reason（`judge-model-unresolved`）,判定后果相同——judge 没有内置默认模型,四层(单次 `{ model }` → Experiment → Eval → config)都没配就是配置错误。

## 相关阅读

- [LLM-as-judge](../library.md) —— 入口、默认材料、鉴权与校验时点的契约单源。
- [Severity 与 Verdict](../../verdict/architecture.md) —— unavailable 为什么不折叠成通过。
