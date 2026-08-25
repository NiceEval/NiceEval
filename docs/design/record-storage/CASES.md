**相关文档**：[README](README.md) · [Goals](GOALS.md) · [Limits](LIMITS.md) · [Decision](DECISION.md)

# Cases

| Case ID | 用户问题 | 固定输入 | 验收结果 |
|---|---|---|---|
| RS1 | 保存小型 rich fact | 一个无 Content/reference、远低于 JSON 上限的 Attempt value | write、Run seal 与 read 返回相同 canonical logical value；没有额外作者配置 |
| RS2 | 保存大 Content | 一个 64 MiB byte Stream，输入 chunk 边界不固定 | write/read 峰值内存受私有 buffer cap 约束；logical length、SHA-256 与 byte order 精确一致 |
| RS3 | 跨 send 增量保存简单事实 | 同一 Attempt 的 50,000 个 plain-data item，分散在多个 send 与 Agent Session | append 执行后 item 不依赖 producer 原对象；Attempt complete 得到一份保持 Host 线性化顺序的 logical collection |
| RS4 | collection 达到 Host cap | retained prefix 后继续 append | append 返回 `omitted`；published collection 保留 prefix，并带 `collection-cap-reached` 与 `omittedAtLeast` |
| RS5 | collection capture 被中断 | 已激活 collection 已保存一个非空 prefix，Attempt outcome 为 interrupted | prefix 保留；logical collection 为 partial，并带 `capture-interrupted` limitation |
| RS6 | 多 Attempt 并发写入 | 同一 Run 内多个 Attempt 同时 append/写 Content，另有不同 Run 并行 | 不同 Run 不共享 writer bottleneck；同 Run 结果完整，scheduler interleaving 不冒充业务顺序 |
| RS7 | writer 在任意物理写入点崩溃 | fault 分别发生在 item、segment/chunk、Seal、rename 与 receipt 前后 | reader 只得到 absent 或通过对应验证的 immutable Run；recovery 不重跑 producer |
| RS8 | 只读一个 family | Run 同时含 Core、多个 rich Attachment、大 Content 与大 collection | ordinary read 不读取无关 family 或未消费 Content；公开 collection read 仍返回完整 logical value |
| RS9 | 完整校验发现损坏 | payload、item、Content segment/chunk、reference 或 Seal inventory 任一 byte 被修改 | `requireComplete()` 或 publication verification 返回具名 invalid/corrupt failure，不提供部分成功 Run |
| RS10 | 搬运 unknown family | catalog 不认识一个 family，但用户复制 root 或执行 storage-only migration | raw family envelope、items、Content 与 references 保持；已知无关 family 继续可读 |
| RS11 | Git/copy 观察 publication | 复制动作分别发生在 active staging、publication commit 前后 | portable root 不含 active staging；复制者只取得旧 closure，或取得新 Run 的完整 published unit |
| RS12 | seal 资源不足 | finalization 遭遇 disk full、I/O error 或临时空间不足 | publication 失败且无成功 receipt；错误说明资源阶段，原 published facts 保持不变 |

每个 `PLAN-N/use-case/README.md` 按这些 Case ID 给出该候选的完整路径，不得降低验收结果。
