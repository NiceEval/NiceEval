# Cases

| ID | 场景 | 必须观察到的结果 |
|---|---|---|
| RR1 | Invocation 用历史 facts 规划、发布新 Run，随后生成 Report | reuse 使用 write session 的 frozen view；Report 另开 snapshot，才能看见新 Run |
| RR2 | 长寿 `view` host 多次 rebuild | 每次 rebuild 使用独立 snapshot Scope；runtime 空闲时不持 maintenance lease |
| RR3 | 同一 Attachment 在两个 generations 中内容完全相同 | 可以共享 verified material；两个 generations 仍有不同 nominal owner handles |
| RR4 | cache 中存在旧 material，但 published path 已改变或 migration 已发生 | 当前 snapshot 重新证明 exact content identity 后才能命中；不得按 path 返回旧值 |
| RR5 | Report snapshot 与另一个进程的 writer 并发 | Report 只看打开时已 complete 的 Runs，writer draft 不进入 snapshot |
| RR6 | snapshot Scope 已关闭但 outer runtime 仍存活 | 旧 view 返回 closed/handle error；cache 不能让 capability 复活 |
| RR7 | migrate 在没有活跃 snapshot/session 时运行 | outer runtime 与空闲 cache 不阻止 exclusive maintenance lock |
