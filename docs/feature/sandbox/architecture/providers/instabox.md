# Instabox Provider —— 架构

Instabox snapshot Provider 的实现。公开用法见 [Instabox](../../library/providers/instabox/README.md)；所有 Provider 共用的契约见 [Architecture](../README.md)。

## 实例、命令与文件

`instabox.ts` 拥有纯配置校验、template identity 和 Provider plan；`instabox/` 拥有 HTTPS 协议解码、Machine 资源、SSH 命令与文件传输。Runner 继续只使用统一 Provider 契约，不按 Instabox 名称分支。

固定服务 origin、snapshot ID、Provider revision、Linux x64 GNU 平台、显式寿命、规范化资源和 PATH 前缀组成 identity。Machine ID、创建幂等键、SSH token 与 API key 不参与 identity；不同 snapshot ID 保守地视为不同 Sandbox 起点，不声称内容等价。配置求值不访问网络。

`materialize` 先验证 snapshot 的具体 ID 与 ready 状态，再以唯一幂等键创建 Machine。请求禁止自动 Vault 或 Org Secrets 注入，明确设置 delete deadline、资源与禁用自动暂停。收费计划必须允许这些设置；拒绝不能降级为可能暂停的机器。创建返回 operation 后，立刻登记资源回收，再等待 operation succeeded 与运行就绪。创建响应失联时只用相同幂等键重取受理结果，不发起第二次逻辑创建。无法取得身份时报告无法确认回收，服务端 delete deadline 是最后上界。

每个 Machine 的 Scope 拥有一次删除职责。失败、取消与正常退出均调用 DELETE，附带确认 ID 和稳定删除幂等键，等待 operation succeeded。已有 operation 冲突时等待其终态后再删除；404 表示资源已不存在。删除失败保持未回收状态并传播错误，不能先标记成功。Snapshot 不由 Attempt Scope 拥有。

HTTPS API 返回值在边界通过 Schema 解码；错误只交付 HTTP 状态、服务错误 code，不转交可能回显凭据的响应正文。默认请求有有界传输超时，资源等待由 Attempt deadline 或显式 lifetime 限制。回收使用独立有界时限，不继承已取消的 Attempt signal。

SSH token 仅由已认证 HTTPS 获取，并以响应中的 SHA256 host key fingerprint 校验 SSH gateway。每台 Machine 只持有一条 SSH 连接，命令与受管进程各占其中一个 channel；连接启用 keepalive，禁用 PTY，stdin 与两个输出流保留原始字节。连接在第一次需要时建立，随 Machine 的 Scope 关闭。一条命令的固定开销是一次 channel 往返，不含握手：同一台 Machine 上连续 20 条 `true` 的总耗时不得超过单条耗时加 20 次往返，验收按这个关系断言，不写死毫秒数。

Sandbox 内 Node supervisor 以 argv 启动目标进程，显式设置 cwd 与 env；参数不作为 shell 源码解释。受管 shell 只在 `runShell` 时选择 Bash。默认非 root 身份来自 snapshot，root 命令由免密 sudo 进入同一 supervisor。

supervisor 不依赖 SSH 会话存活。它为每个进程在 Machine 上建一个只属于该进程的 spool 目录，把 stdout、stderr 按原始字节追加写入各自的文件，进程结束后原子写入退出文件（退出码或信号）。channel 只是这些文件的读取端：客户端保存每个流已经交付的字节偏移，读到退出文件之后进程才算结束。

stdin 同样按偏移交付。supervisor 把已经写进目标进程管道的 stdin 字节数持久化在 spool 里，EOF 是否已送达也在其中；客户端保留尚未被确认的字节，收到确认后才丢弃。Agent 驱动进程这类全程开着 stdin 的双向进程靠这一条跨过断线：它运行时间最长，丢一次就是整个 Attempt。普通命令的前台进程结束后写入退出文件，不等待后台服务继承的管道关闭；有意启动的独立服务继续运行。

连接断开不等于进程丢失。连接或 channel 异常时，Provider 在 60 秒内最多重连 3 次，重连成功后从已交付的偏移继续读取同一个 spool，并向 supervisor 取回已接收的 stdin 字节数，从该偏移补发未确认的字节与 EOF。调用方看到的输出不重复、不缺失，目标进程收到的 stdin 不重复、不缺失，命令事实只有一条。同一台 Machine 上的全部进程共用这一次重连。重连期间命令自己的时限照常计时。以下情况才退休并删除整台 Machine，等待确认后再 settle：

- 重连次数或时限用完；
- 重连后 spool 目录或 supervisor 不存在；
- 命令超时或取消后，supervisor 未能在有界时限内终止目标进程组并写入退出文件。

命令超时或取消本身不退休 Machine：supervisor 向该命令的整个进程组发送终止信号，确认退出文件写入（即进程组已静止）后，命令以 cancelled 或 timeout 结算，Machine 与同一连接上的其它进程继续使用。一台 Machine 往往同时承载 Agent 驱动进程、遥测收集与并发的 Agent Judge 命令，取消其中一条不能连带删除其余进程依赖的环境。

退休时抛出的错误写明触发原因（keepalive 超时、连接被对端关闭、channel 错误、握手失败等 ssh 层给出的原因）、重连次数、进程已运行时长和已交付的字节数，随 Attempt 的 failure diagnostic 保存。错误文本不含 token。成功重连写一条 `sandbox-transport-reconnected` Observability diagnostic，带同样的原因与次数，不改变命令结果与 Verdict。Machine 因传输失败退休之后，对同一个 Sandbox 的后续命令与文件操作都以这次退休的原因失败，不把服务端返回的 404 当作首要错误交给调用方。正常退出只归还 channel。外层 Scope 最终删除实例，包含其余后代进程。

文件使用原生 HTTP bytes 接口。目录上传把整棵目录打成一个归档，经一次 HTTP 写入送达，再用一条命令展开并一次设好全部权限位；命令条数与目录里的文件数、目录数无关。目录下载同样是一条归档命令加一次 HTTP 读取。归档展开失败按命令失败处理，不留下只展开了一部分却报告成功的目录。Provider 只将文件不存在解释为 false；权限与传输失败继续抛错。reuse、retention 与 Nested Docker capability 都明确 Unsupported，不以快照存在推定这些能力；Before cache 见 [远端 snapshot Before cache · Instabox](#远端-snapshot-driver)。

验收由安装后的公开入口驱动：校验非法配置、从固定 snapshot 创建实例、读写二进制文件、argv 特殊字符、非零退出、流式输出、双向 Agent 进程、取消与正常收尾。使用真实 API 读回 Machine 不存在和基础 snapshot 仍 ready，并回收验收专属快照。命令超过 600 秒的支持由无 HTTP exec 的传输路径保证，长时实际运行另行按成本执行。连接复用、断线续读与目录传输另有四条验收：

- 同一台 Machine 上连续命令的耗时关系。
- 命令运行中由测试从客户端一侧强行断开 SSH 连接，命令仍以原退出码结束、输出逐字节完整，并留下 `sandbox-transport-reconnected`。
- 一个持续读写 stdin 的双向进程在两次写入之间被断开，重连后对端收到的字节序列与发送的完全一致，EOF 只送达一次。
- 上传一棵含多层目录与可执行文件的目录后，Record 里只有一条展开命令，权限位读回一致。

## Provisioning 对账与重试

通用分类与两道防线见 [Architecture · Provisioning 失败与重试](../README.md#provisioning-失败与重试)。Instabox 的 `create()` 包含 snapshot 校验、Machine 创建、operation 等待、运行就绪查询与首次 SSH grant。各请求按下列规则处理：

- **只读查询原地重试**：snapshot GET、创建 operation GET 与运行就绪 GET 都是幂等读取，在原 snapshot、operation 或 Machine 上做有界重试。瞬时判定与次数沿用[已创建 Sandbox 的文件 IO 重试](../README.md#已创建-sandbox-的文件-io-重试)的分类器与上限，退避受 create 截止时间约束，取消立即停止。重试只重复读取，不发起新的创建或签发。
- **Machine 创建**：响应失联时只用相同幂等键重取受理结果，不发起第二次逻辑创建，见上节。
- **首次 SSH grant**：服务端没有证明 grant 支持幂等重取，因此只有拒绝类失败（连接建立失败、限流）原地重试。歧义类失败（响应中途断开、请求超时、5xx）不重复签发，按 `create()` 失败处理：kill-on-failure 删除该 Machine 并等待删除确认，再抛出原始错误。
- **整个 `create()` 重试**：对账通道是创建幂等键重取加删除确认。初始化失败的 Machine 确认删除之后，重试层才以新的幂等键重建，次数与退避和其它内置 Provider 相同。删除无法确认时对账失败，放弃重试并抛回原始错误，服务端 delete deadline 是最后上界。

不在 HTTPS 客户端上加全局重试。同一客户端还承担文件传输、删除与 snapshot 创建，它们各有自己的重试或对账规则。

## 远端 snapshot driver

协议与 core 的捕获步骤见 [远端 snapshot Before cache](../remote-snapshot-cache.md)。Instabox driver 交出的原语：

- **driver**：`preserves = { disks: ["/", "/data"], memory: false }`（默认 workdir 在 `/data/home/workspace`）；`sourceUsableAfterSnapshot = true`。retention 与 Nested Docker 仍为 Unsupported，不支持 Sandbox 复用。
- **Base 身份**：声明的 `snapshotId`（`sn_` 开头）或 `templateId`（别名 `template`，省略时默认为 `universal`）；Instabox snapshot 的内容按 ID 不可变。
- **execution domain**：`hash("https://api.instabox.sh", sha256(API key))`。
- **createSnapshot**：对 staging Machine 发起包含 root 与 `/data` 的 snapshot 保存请求，等待 status 变为 `ready`；`failed` 是错误。等待期间读取 snapshot 状态的 GET 是幂等读取，按[只读查询原地重试](#provisioning-对账与重试)的分类器与上限重试，单次瞬时失败不让已受理的 snapshot 变成结果不确定。服务以明确错误码拒绝且未返回 operation 时为 `Rejected`。具体 HTTP 路径以 Instabox API 为准，像现有 Machine 接口一样在边界用 Schema 解码。
- **一致性**：Instabox 的 live snapshot 等同于断电时的磁盘内容；两个盘是否在同一时刻捕获没有服务端证据。quiesce 保证 snapshot 期间没有 NiceEval 发起的写入，因此 core 不依赖跨盘原子性。
- **createFromSnapshot**：以 snapshot ID 创建 Machine，沿用现有创建、探测与删除契约；Vault 与 Org Secrets 自动注入保持关闭。
- **findSnapshot**：Instabox 不提供按名称查询，`/v1/snapshots/{id}` 只接受 ID。driver 读取 `GET /v1/snapshots` 的全部分页，按 `name` 严格相等匹配；多于一个匹配是错误。每页读取同样按只读查询规则原地重试。
- **deleteSnapshot**：`DELETE /snapshots/{id}`，404 返回 `absent`。
