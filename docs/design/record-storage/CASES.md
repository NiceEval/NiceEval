**相关文档**：[README](README.md) · [Goals](GOALS.md) · [Limits](LIMITS.md) · [Decision](DECISION.md)

# Cases

| Case ID | 用户问题 | 固定输入 | 验收结果 |
|---|---|---|---|
| RS1 | 保存小型 rich fact | 一个无 Content/reference、远低于 JSON 上限的 Attempt value | write、Run seal 与 read 返回相同 canonical logical value；没有额外作者配置 |
| RS2 | 保存超过旧上限的 Content | 一个大于旧 64 MiB 的 deterministic byte Stream，输入 chunk 边界不固定；harness 的私有 rollover threshold 小于该 Content | logical Content 跨至少两个 physical members；write/stream-read RSS 有界且不先形成完整 `Uint8Array`；logical length、SHA-256 与 byte order 精确一致；fixture size 与私有 threshold 不进入产品 API |
| RS3 | 跨 send 增量保存简单事实 | 同一 Attempt 的 50,000 个 tiny plain-data item，分散在多个 send 与 Agent Session；canonical bytes、nodes 与 depth 保持在本 Case 的目标 cap 内 | 每次 append 都返回 `retained`，且 item 不依赖 producer 原对象；Attempt complete 得到一份保持 Host 线性化顺序的 logical collection；full read 的 RSS 与 latency 通过采用门 |
| RS4 | collection 达到 Host cap | 使用真实产品 cap，构造第一个超过 adopted item-count、encoded-bytes、nodes 或 depth 组合边界的 item；不使用测试专用低 cap | 首个超限 append 返回 `omitted`；published collection 保留 prefix，并带 `collection-cap-reached` 与 `omittedAtLeast` |
| RS5 | collection capture 被中断 | 已激活 collection 已保存一个非空 prefix，Attempt outcome 为 interrupted | prefix 保留；logical collection 为 partial，并带 `capture-interrupted` limitation |
| RS6 | 多 Attempt 并发写入 | 同一 Run 内多个 Attempt 同时 append/写 Content，另有不同 Run 并行 | 不同 Run 不共享 writer bottleneck；同 Run 结果完整，scheduler interleaving 不冒充业务顺序 |
| RS7 | writer 在任意物理写入点崩溃 | fault 分别发生在 item、下一 member、首个 segment、index page、catalog page、Seal page、catalog/Seal root、旧 member close、fsync、complete、rename 与 receipt 前后 | reader 只得到 absent 或通过对应验证的 immutable Run；root 不指向未同步 page；recovery 不重跑 producer |
| RS8 | 只读一个 family | Run 同时含 Core、多个 rich Attachment、大 Content 与大 collection | ordinary read 不读取无关 family 或未消费 Content；公开 collection read 仍返回完整 logical value |
| RS9 | 完整校验发现损坏 | payload、item、Content segment、index/catalog/Seal page、reference 任一 byte 被修改，或 pack 被截断 | `requireComplete()` 或 publication verification 返回具名 invalid/corrupt failure，不提供部分成功 Run |
| RS10 | 搬运 unknown family | catalog 不认识一个 family；用户复制 root，或把旧 digest-file storage 显式迁移到 rolling storage | raw family envelope、items、Content 与 references 保持；converter 流式生成新 closure，不调用 unknown family Schema；ordinary read 不静默迁移 |
| RS11 | copy 观察 publication | 复制动作分别发生在 active staging、publication commit 前后；另用 Git 搬运可接受体积的 fixture | portable root 不含 active staging；复制者只取得旧 closure，或取得新 Run 的完整 published unit；Git 拒绝超大运输不能让源 Record invalid |
| RS12 | seal 资源不足 | finalization 遭遇 disk full、I/O error 或临时空间不足 | publication 失败且无成功 receipt；错误说明资源阶段，原 published facts 保持不变 |
| RS13 | 多个 Content 累计超过旧上限 | 同一 Attachment 含三个 bytes 不同、各 48 MiB 的 logical Content，总量 144 MiB；输入 chunk 边界不固定 | write、seal、stream read 与完整校验成功；writer/stream reader RSS 不随 144 MiB 合计线性增长；ordinary read 不读取未消费 Content；不能触发旧 aggregate failure |
| RS14 | 很多小 Content 撞到结构上限 | 同一未发布 Attachment 持续增加不同的小 Content，直到首先超过 handle、member、index/catalog 或 Seal inventory 的共同结构 ceiling | ceiling 内的小 Content 使用候选的 shared member/table strategy；首个超限 write 以 structure-invalid fail closed，不形成领域 partial，也不冒充本机 admission |
| RS15 | 整体读取所需内存超出本机 admission | 已发布的大 Content 合法；测试 Host 的 whole-value read admission 小于认证的 logical `byteLength` | `content.byteLength(handle)` 不读取 Content；`content.bytes/text` 在分配前返回 typed admission failure，包含 logical byteLength 并提示 `content.stream`；Attachment 仍 available，stream read 成功 |
| RS16 | rolling Seal 精确识别成员 | 对已发布 Run 分别增加额外 member、删除 member、截断 inventory page；另 ordinary read 一个不相关 family | full validator 对 extra/missing/truncated 返回 corruption；ordinary family read 不扫描全部目录，也不宣称整 Run complete |
| RS17 | metadata 也会 rollover | harness 使用很小的私有 page threshold，让一份适中 Content 跨至少两个 range-index pages，并让 Seal root 指向至少两个 inventory pages | index/catalog/Seal rollover 不改变 logical handle；ordinary stream 只持有当前 page/segment；full validation RSS 有界；私有 threshold 不进入 product contract |

每个 `PLAN-N/use-case/README.md` 按这些 Case ID 给出该候选的完整路径，不得降低验收结果。
