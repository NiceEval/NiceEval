# Goals

- reuse planning 与 Analysis 使用同一个 `FrozenRecordView` 事实解释，不形成两套 decoder/projector。
- host 可以在一次 operation 内统一 canonical root identity、runtime registry 与 snapshot generations。
- locks 只在具体子操作的 Scope 内持有，长寿 host 不持续阻止 migration。
- verified read cache 可以安全跨 generations 复用 material，但不能改变任何可观察结果。
- Invocation、Report 与 maintenance 只获得各自所需的 nominal capability。
- publish 后的可见性始终通过新 snapshot 表达，不刷新已有 handles。

本决策不合并 reuse policy 与 Analysis selection，也不让 Attempt execution 或 Report author 读取 Record access runtime。
