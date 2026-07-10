# langgraph 示例：niceeval Tier 3 接入（侵入改造 + experiment flags）

这是 [`examples/zh/tier2/langgraph`](../../tier2/langgraph/) 的**副本 + 一层侵入 delta**
（分档定义见 [docs-site · Tier](../../../../docs-site/zh/concepts/tier.mdx)）。前两档应用代码
一行不改;这一档**改应用内部代码**(Python 侧),把内部可变点暴露成 experiment 可选的配置
——对照的不再只是模型,而是应用自己的行为变体。

这个应用暴露的可变点:**system prompt**(`docs/origin-integration.md`「Tier 3 备忘」点名
的最小侵入点之一)。相对 tier2 的全部差异:

- `src/backend/agent.py`:`build_agent(system_prompt=None)` 接受 prompt 覆盖;
  `InMemorySaver` 提到模块级共享(`_SAVER`)——`create_agent` 的 system prompt 是图的
  编译期参数,每个变体要各自编译一张图,但共用同一个 checkpointer,同一个 `thread_id`
  的会话记忆与 interrupt/resume 检查点跨变体延续。**不传时行为与改造前完全一致**。
- `src/backend/server.py`:`/api/chat` 请求体多一个可选字段 `systemPrompt`(类型校验),
  同一个变体的图编译一次后缓存复用;`_run_turn`/`_drive_graph` 改为显式接收 agent,
  不再读模块全局。
- `agents/langgraph.ts`:experiment 的 `flags.systemPrompt` 经 `ctx.flags` 随请求体透传。
- `experiments/compare-prompts/`:默认 prompt vs 极简风格两个变体。
- 本 README。

注意侵入的是**应用**(把变体暴露成配置),不是接入面——adapter 依然只对着 HTTP 端点收发,
eval 侧照旧不 spawn 进程、不开新端口。

## flags 怎么流动

```
experiments/compare-prompts/concise.ts  →  flags: { systemPrompt: "…极简…" }
agents/langgraph.ts                     →  ctx.flags.systemPrompt 塞进请求体
src/backend/server.py                   →  校验后 _agent_for(systemPrompt) 选图
src/backend/agent.py                    →  build_agent(system_prompt or SYSTEM_PROMPT)
```

evals 一条没改——feature A/B 的判读就是同一批 eval 在不同变体下的对照:极简变体下工具
断言、HITL 批准/拒绝应当照常绿(变体 prompt 原样保留了工具规则),看点在 judge 分与回复
长度的差异。HITL 的 interrupt 在哪个变体的图上停,resume 就在哪个变体的图上续——同一
实验组内 flags 恒定,不会串。

## 跑起来

```sh
cd examples/zh/tier3/langgraph
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # 只需要建一次
pnpm install
cp .env.example .env   # 填 OPENAI_API_KEY(这里挪用给 DeepSeek,见 niceeval.config.ts 注释)

# 终端 1:起应用(OTel 部分与 tier2 相同,要瀑布图就带上这些环境变量)
LANGSMITH_TRACING=true LANGSMITH_OTEL_ENABLED=true LANGSMITH_OTEL_ONLY=true \
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318/v1/traces OTEL_BSP_SCHEDULE_DELAY=200 \
.venv/bin/python src/backend/server.py

# 终端 2:跑 A/B(两个变体打同一个应用实例,不用重启)
pnpm exec niceeval exp compare-prompts
pnpm exec niceeval view
```

单配置基线 `pnpm exec niceeval exp langgraph` 仍然可用(不带 flags,应用走默认行为)。
其余细节(帧协议、HITL 机制、能力验证)见 [tier1 README](../../tier1/langgraph/README.md)
与 [tier2 README](../../tier2/langgraph/README.md),这一层没有改变它们。
