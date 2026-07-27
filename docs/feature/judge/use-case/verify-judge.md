# Judge：接上兼容网关并确认真实判分

## 解决什么问题

judge 是唯一一个「配错了也能看起来跑通」的评分机制:被测 agent 照常跑、断言照常出现在报告里,只有分数是假的。
判分端点连不上、网关拒了鉴权、响应取不出分数——这些都不是 agent 的问题,却会落在 agent 的成绩单上。
这条路径要的是**每次都能回答「这批分数是不是真的评出来的」**,而不是靠盯着分数像不像话来猜。

## 全流程

1. 端点和模型是配置,写进代码;key 是凭据,只从环境变量来(契约见 [LLM-as-judge ·
   模型与鉴权](../library.md#模型与鉴权)):

   ```ts
   // niceeval.config.ts
   export default defineConfig({
     judge: { model: "gpt-5.4-mini", baseUrl: "https://gateway.example.com/v1", apiKeyEnv: "MY_GATEWAY_KEY" },
   });
   ```

   **接兼容网关时 `baseUrl` 必须显式写。** 只配 key 不配 `baseUrl`,niceeval 打的是官方端点
   `https://api.openai.com/v1`。此时网关凭据会被发到 OpenAI，返回「Incorrect API key provided」。
   这看上去像 key 过期，实际是端点选错了。

2. 跑一次。派发任何 attempt 之前先过 judge 预检——端点不通就地停下,不会先烧完一批 agent 成本再告诉你:

   ```bash
   niceeval exp compare
   ```

   **你会看到**:预检期间面板顶上一行 `● prechecking judge config <elapsed>`(非 TTY 是起止两行),
   这一行在解释「为什么 attempt 还都是 `queued`」;网络抖一下不会失败,传输层错误会退避重试,那一行的 elapsed
   继续走。

3. 预检失败的话,`fix:` 就是下一步,按它改配置重跑:

   ```text
   error: judge precheck failed: 401 from https://api.openai.com/v1 (Incorrect API key provided)
     fix: baseUrl 省略时用官方端点;接兼容网关请在 judge.baseUrl 显式写出地址,key 走 judge.apiKeyEnv 指定的变量(默认 NICEEVAL_JUDGE_KEY)
   ```

4. 跑通后确认分数**真的**评出来了:

   ```bash
   niceeval show <eval-id>
   ```

   **你会看到**:每条 rubric 后面跟着分数。跑中判分请求失败(网关回 400、连接断、超时)的那条不会伪装成 0
   分通过——它记 `◌ unavailable · judge-call-failed`,`evidence` 里是状态码或异常摘要,这次 attempt 判
   `errored`。**「裁判挂了」和「agent 答得一塌糊涂」在报告上长得不一样**,
   这正是这套记录方式存在的理由:前者去修配置,后者去修 agent。

5. 确实允许某条 rubric 缺席(实验性的、没 key 的开发机上也要能跑)时,在那一条上显式声明:

   ```ts
   t.judge.autoevals.closedQA("文风是否友好?").optional();
   ```

   **你会看到**:它评不了时只留一条 unavailable 记录,不再把 attempt 拖成 `errored`;其余没写 `.optional()`
   的 rubric 照旧要求可评估。

## 边界

- 允许缺席是**逐条断言的作者决定**,不是框架的降级策略:预检失败不会自动退化成 warning 让 judge
  断言静默跳过——那会造出「一条都没评却全绿」的报告。
- `--strict` 不改变这条路径上的任何判定:unavailable 走 `errored`,与 soft 阈值是两回事(见
  [`--strict`](../../verdict/use-case/strict-quality-gate.md))。
- 有 HTTP 状态码回来的失败(401 / 404 / 400)不重试,只有传输层错误重试:配置错了重试三次还是错,徒增等待。
- 模型解析不到是另一个 reason(`judge-model-unresolved`),判定后果相同——judge 没有内置默认模型,三层(单次
  `{ model }` → eval → config)都没配就是配置错误。

## 相关阅读

- [LLM-as-judge](../library.md) —— 入口、默认材料、鉴权与派发前预检的契约单源。
- [Severity 与 Verdict](../../verdict/architecture.md) —— unavailable 为什么不折叠成通过。
- [Experiments · judge 预检的显示](../../experiments/cli.md#judge-预检的显示) —— 预检在 live 面板与
  `--json` 里各长什么样。
