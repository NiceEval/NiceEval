# langgraph 示例：niceeval Tier 2 接入（send + OTel）

这是 [`examples/zh/tier1/langgraph`](../../tier1/langgraph/) 的**副本 + 一层 OTel delta**
（分档定义见 [docs-site · Tier](../../../../docs-site/zh/explanation/tier.mdx)）。同一个 adapter
骨架、同一批 evals/experiments,断言一条不变;这一档买到的是**观测**:`niceeval view` 的
调用瀑布图。

相对 tier1 的全部差异只有三处(`examples/zh/diffs/` 里有自动导出的 patch 可读):

- `niceeval.config.ts`:加 `telemetry: { port: 4318 }`——固定端口接收 span。
- `agents/langgraph.ts`:加一段 span 收尾宽限(`OTEL_FLUSH_GRACE_MS`,LangSmith 的
  `BatchSpanProcessor` 调度和 SSE 流关闭是两条独立时间线,轮次结束后主动等一小段把最后
  一批 span 收进瀑布图),以及随请求带 `ctx.telemetry.headers` 的 traceparent(server.py
  没接 OTel 服务端埋点,现在读不到这个头,span 走时间窗口归属、该 agent 的轮次自动串行
  ——传了是面向未来:应用哪天接了 W3C trace context 传播就免费解锁精确归属和并发)。
- 本 README。

**应用侧依然零改动**:Python 版 `langsmith` SDK 是真·零代码——`LANGSMITH_TRACING` 等四个
环境变量(见「跑起来」)设好,`langchain_core` 默认的 tracing callback 第一次调模型时就会
自动接好 OTel exporter。Tier 2 只是让这些 span **也发给 niceeval 一份**。

## span 只进瀑布图,不喂断言

事件断言的数据来源始终是应用自己的 SSE 协议帧(见 tier1 README),零 OTel 依赖。span 晚到、
缺失时也只是瀑布图缺一块,断言判决不受影响。一个易踩的坑:Python `langsmith` SDK 把
`OTEL_EXPORTER_OTLP_ENDPOINT` 当**完整 endpoint** 用,要带 `/v1/traces` 尾巴——**和
codex-sdk/ai-sdk-v7 相反**,那两个应用自己拼尾巴。

## 跑起来

和 tier1 的唯一区别:起应用时给 LangSmith OTel 导出的环境变量。

```sh
cd examples/zh/tier2/langgraph
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # 只需要建一次
pnpm install
cp .env.example .env   # 填 OPENAI_API_KEY(这里挪用给 DeepSeek,见 niceeval.config.ts 注释)

# 终端 1:起应用(注意 langsmith SDK 要完整路径,端点带 /v1/traces 尾巴;
# niceeval 的接收端口钉在 4318,被占时改 niceeval.config.ts 的 telemetry.port 并同步这里)
LANGSMITH_TRACING=true LANGSMITH_OTEL_ENABLED=true LANGSMITH_OTEL_ONLY=true \
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318/v1/traces OTEL_BSP_SCHEDULE_DELAY=200 \
.venv/bin/python src/backend/server.py

# 终端 2:跑 eval(应用部署在别处时设 LANGGRAPH_URL 指过去)
pnpm exec niceeval exp langgraph
pnpm exec niceeval view   # 这一档开始,view 里有调用瀑布图
```
