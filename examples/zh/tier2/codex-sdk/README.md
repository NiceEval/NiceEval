# codex-sdk 示例：niceeval Tier 2 接入（send + OTel）

这是 [`examples/zh/tier1/codex-sdk`](../../tier1/codex-sdk/) 的**副本 + 一层 OTel delta**
（分档定义见 [docs-site · Tier](../../../../docs-site/zh/explanation/tier.mdx)）。同一个 adapter
骨架、同一批 evals/experiments,断言一条不变;这一档买到的是**观测**:`niceeval view` 的
调用瀑布图。

相对 tier1 的全部差异只有三处(`examples/zh/diffs/` 里有自动导出的 patch 可读):

- `niceeval.config.ts`:加 `telemetry: { port: 4318 }`——固定端口接收 span,长驻服务必须走
  run 级共享接收器(固定端口模式)。
- `agents/codex-sdk.ts`:加 `spanMapper: mapCodexSpans`(`"niceeval/adapter"` 公开导出)——
  codex 的 span 是自家命名,归一成 canonical GenAI 语义后瀑布图才能正确着色分组,和内置
  `codexAgent` 的瀑布图一致。
- 本 README。

**应用侧依然零改动**:origin 的 `src/backend/agent.ts` 本来就给 Codex CLI 配了原生 `otel`
配置段(trace 导出发生在 codex 子进程内部,默认开启),Tier 2 只是让这些 span **也发给
niceeval 一份**。

## span 只进瀑布图,不喂断言

事件断言的数据来源始终是 `ThreadEvent` 流(官方转换器 `fromCodexThreadEvents`,见 tier1
README),和 span 无关。span 晚到、缺失时也只是瀑布图缺一块,断言判决不受影响。

## 跑起来

和 tier1 的唯一区别:起应用时把 OTel 指到 niceeval 的固定接收端口(codex 配置里自己拼
`/v1/traces`,这里给 base URL)。

```sh
cd examples/zh/tier2/codex-sdk
pnpm install
cp .env.example .env   # 填 CODEX_API_KEY / CODEX_BASE_URL

# 终端 1:起应用(本机 4318 被占时,两边一起换:应用改这里的端口,
# eval 侧改 niceeval.config.ts 的 telemetry.port)
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 pnpm start

# 终端 2:跑 eval(应用部署在别处时设 CODEX_SDK_URL 指过去)
pnpm exec niceeval exp codex-sdk
pnpm exec niceeval view   # 这一档开始,view 里有调用瀑布图
```

`workspace/` 目录会在磁盘上留下 eval 跑过的文件,这是预期行为,同 tier1。
