# openai-compat E2E

被测对象:`niceeval/adapter` 的 `fromChatCompletion` 与 `fromResponses`——两个 OpenAI 两种响应
形状（Chat Completions / Responses）的官方结果转换器。本仓库用真实 OpenAI 兼容网关证明这两种
协议形状在线上确实长这样。评估计划见 `docs/engineering/e2e-ci/adapters/openai-compat.md`（niceeval
checkout 内）。

```sh
pnpm install
pnpm e2e
```

`pnpm e2e` 独立完成：清理上次运行结果、以 `--force` 跑两个真实 Experiment、用 `niceeval show` 系列
命令做 CLI 读回验收、按结果分类进程退出码（见 `scripts/e2e.ts`）。

## 两个 Agent

- `agents/chat-completions.ts`：直连 `POST {OPENAI_BASE_URL}/chat/completions`。`actions` 证据通道
  声明 `partial`——Chat Completions 的协议契约不承诺响应记录完整决策过程，所以本仓库不为这条路径
  写负断言 Eval。
- `agents/responses.ts`：直连 `POST {OPENAI_BASE_URL}/responses`。`actions`/`events` 通道声明
  `complete`——Responses 的协议契约里 `output` 数组记录完整决策过程，负断言（`notCalledTool`）可信。

## Responses 取证路径

`agents/responses.ts` 的 `callResponsesApi` 优先直接调真实 `/responses`；只有网关明确用 HTTP 404
声明"没有这条路由"时，才退化为把一次真实 `/chat/completions` 响应翻译成 `ResponseLike` 形状（真实
模型调用的 tool_calls/content/usage，只有外层形状是本仓库翻译的），并记一条 diagnostic 说明白。
触发这条退化路径时，仓库证明的是 `fromResponses` 的映射逻辑在真实数据上工作，**不证明网关本身在线
上吐出 Responses 形状**——这两者是不同的断言，代码与 diagnostic 消息都刻意分开说。

## 已知阻塞:分配的凭据被网关禁用

本仓库分配的 `OPENAI_API_KEY`（与 `NICEEVAL_JUDGE_KEY` 字节完全相同）对 `OPENAI_BASE_URL`
(`https://s2a.jihuayu.site/v1`) 的每个探测端点都返回：

```json
{"code":"API_KEY_DISABLED","message":"API key is disabled"}
```

直接 curl `/chat/completions`、`/responses`、`/models` 三个端点均如此，排除了请求构造错误（用同一套
请求形状换一把已知在别处有效的 key 会得到不同的 `INVALID_API_KEY`，说明网关认识这把 key、只是禁用了
它）。这也意味着 `/responses` 在这把 key 下始终先被鉴权中间件拦截（401），"网关是否真的路由这个端点"
在鉴权恢复前无法确证——见上面「Responses 取证路径」。

`scripts/e2e.ts` 把 `API_KEY_DISABLED` 计入能确证的外部故障（EX_TEMPFAIL/75），不当作回归；一旦这把
key 被重新启用或轮换，`pnpm e2e` 不需要任何代码改动即可转绿。
