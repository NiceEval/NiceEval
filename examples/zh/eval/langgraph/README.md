# LangGraph ReAct agent × niceeval(自己写 deployed adapter)

这个例子在一个普通的 LangGraph 应用(`createReactAgent` + `node:http` 服务器 + 两个工具
`get_weather` / `calculate` + `MemorySaver` checkpointer)的基础上接入 niceeval。应用代码
(`server.ts` / `agent/` / `observability.ts` / `public/`)复制自
[`examples/zh/origin/langgraph`](../../origin/langgraph/) 的一个早期快照——origin 那份后来
重写成了纯 Python 项目(手搭 `StateGraph` + 标准库 `http.server`),和这里的 TS 实现在
语言层面就分道扬镳了,这里保留旧的 `node:http` + JSON 接口不动,因为下面的 adapter 依赖它;
niceeval 相关的东西全部是新增文件:

- `agents/langgraph.ts`——deployed agent 风格的 adapter(见
  [`docs-site/guides/remote-agent.mdx`](../../../../docs-site/guides/remote-agent.mdx)):
  `send` 里懒启动 `server.ts`(端口 5388,轮询 `/healthz`),然后对 `/api/chat` 发一次
  `fetch`,把 `{reply, toolCalls}` 映射成标准 `StreamEvent[]`。
- `experiments/langgraph.ts`——把 adapter 接成实验(`defineExperiment({ agent, ... })`)。
- `niceeval.config.ts`、`evals/*.eval.ts`。

## 会话隔离:为什么 adapter 里有 `ctx.session.id ??= crypto.randomUUID()`

`server.ts` 对没传 / 空字符串的 `sessionId` 一律回退成字面量 `"default"`——它不会替一个
全新会话生成新 id。niceeval 每个 eval / 每次 `t.newSession()`,第一次 `send` 之前
`ctx.session.id` 都是 `undefined`。如果原样透传给 `/api/chat`,所有会话都会落到同一个
LangGraph `thread_id: "default"` 上,互相看得见对方的工具调用历史——`t.newSession()` 起
的「全新会话」名不副实。所以 adapter 在发请求前自己钉一个 uuid,让每个 niceeval 会话
对应一个独立的 LangGraph thread。

## 会话累积:`toolCalls` 是整段 thread 历史,不是本轮增量

`agent/agent.ts` 的 `extractToolCalls()` 从 `MemorySaver` 的整个 checkpointer 历史里抠
`{name, input, output}`,所以同一个 `sessionId` 的第 N 轮请求,`toolCalls` 数组包含第
1..N 轮的全部工具调用。`agents/langgraph.ts` 如实把它们全部映射成事件——不做「只留本轮」
的二次加工。`evals/session-isolation.eval.ts` 演示这个行为:同一 session 内的第二轮,
事件流理应同时看到两轮的工具调用(不能断言排他/精确计数);只有 `t.newSession()` 开出的
全新 `thread_id` 才是真正干净、看不到主 session 历史的。

## judge 用独立凭证,不和应用的模型配置共用

这个 app 的 `.env` 把标准的 `OPENAI_API_KEY` / `OPENAI_BASE_URL` 挪用给了 DeepSeek
(`agent/agent.ts` 里 `ChatOpenAI` 直接读这两个 env 名)。niceeval 的 judge
(`t.judge.autoevals.*`)找 OpenAI 兼容 key 时,同样这两个名字是它兜底链路的最后一环
(见 `src/scoring/judge.ts`)——如果不额外声明独立的 judge 凭证,judge 请求会静默发去
DeepSeek 要一个它没有的模型。所以 `.env` 里另配了 `NICEEVAL_JUDGE_KEY` /
`NICEEVAL_JUDGE_BASE`(judge.ts 里优先级最高的一对),`niceeval.config.ts` 声明
`judge: { model: "gpt-5.4" }`,`evals/weather-tool.eval.ts` 用
`t.judge.autoevals.closedQA(...)` 评回复质量——和应用自己的模型凭证互不干扰。

## 跑起来

这个目录是一个**独立的 npm 项目**(自带 `package.json`,`niceeval` 以 link 方式指向仓库根)。

```sh
cd examples/zh/eval/langgraph
pnpm install
# .env 已经带着真实凭证(gitignored),跑之前确认 OPENAI_API_KEY / OPENAI_BASE_URL /
# AGENT_MODEL 三个变量填的是 DeepSeek 的

pnpm exec niceeval list          # 列出 3 条 eval
pnpm exec niceeval exp langgraph # 跑全部——adapter 会按需拉起 server.ts(端口 5388)
pnpm exec niceeval view          # 本地查看器
```

不需要手动 `pnpm dev` 起服务;也可以手动起(比如要在浏览器里试聊天),adapter 的
`ensureServer()` 探测到端口已经在监听会直接复用,不重复拉起。
