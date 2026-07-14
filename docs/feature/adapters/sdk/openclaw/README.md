# OpenClaw

OpenClaw 的接入面是内置 sandbox Agent：

```ts
openClawAgent(config)
```

该工厂复用 `defineSandboxAgent`、共享安装工具、session 存取器与 canonical OTel mapper，不把 OpenClaw 方言加入 core。

实现前必须用真实 CLI 与 transcript fixture 固定以下事实：

1. `agent --json` 的消息、工具、失败与 usage 字段；
2. 工具调用是否具有稳定 call ID，并发时能否可靠配对；
3. 首轮取得 session key、后续 resume 和新 session 隔离；
4. 超时 fallback 是否产生第二条 run，以及怎样避免重复采集；
5. transcript 是否足够完整以支撑负断言；
6. OTel 内容关闭时仍只影响 trace，不影响事件流。

只有 fixture 证明完整的行为才进入公开能力。拿不到完整工具轨迹时，Adapter 必须明确限制负断言，而不是从最终文本猜测调用过程。
