# OpenSandbox Provider —— 架构

所有 Provider 共用的契约见 [Architecture](../README.md)。

## 实例与命令

OpenSandbox provider 通过服务 API 将一个远端 Sandbox 绑定到现有 Attempt resource group；创建、命令、文件与销毁均由 provider 持有，Runner 不按名称分支。公开声明见 [Library](../../library/providers/opensandbox/README.md)。Docker、Kubernetes 等 runtime 由 OpenSandbox 服务端选择，不进入 NiceEval 的选项、计划 identity 或准入判断。服务部署和隔离策略归基础设施；provider 不从 runtime 名称推断专用 kernel 或 DockerExecution。

`openSandbox` 使用官方 `@alibaba-group/opensandbox` SDK，依赖延迟加载。连接地址和 API key 从 `OPEN_SANDBOX_DOMAIN`、`OPEN_SANDBOX_API_KEY` 读取，API key 只进宿主 transport，不进入 identity、镜像变量集合或命令。

所有请求使用 server proxy 并保留 SDK 返回的 endpoint 路由与认证 header。当前接入使用服务代理，不要求 execd 的 secureAccess；服务必须使用仅可信宿主可访问的私有入口，或在 HTTP/WebSocket 全路径前置鉴权。控制 API key 本身不能保护上游免鉴权的 proxy 路由。禁用 SDK create telemetry。目标平台由声明显式给出，不能从宿主架构推断远端镜像。

起点是 image，工作目录为 `/home/sandbox/workspace`。发布 identity 包含 image、目标平台、资源限制、user、pathPrepend 与 lifetimeMs；连接与凭据不构成可分享内容。单实例只有一个销毁 owner。创建不自动重试歧义结果；获取实例后立即登记 Scope finalizer，ready 或工作目录初始化失败也销毁。lifetimeMs 可省略，省略时按 [服务端寿命](../../library/reuse.md#两种时间不能混用)派生；显式值不得短于 Attempt 剩余时限与 30 秒收尾预留。实例仍随 Scope 关闭。有限寿命负责客户端崩溃后的最终回收，不替代取消确认。服务拒绝该寿命时保留真实失败，不静默缩短。

每次创建携带随机 provision token。创建失败后按该 token 查询并销毁已分配的实例，不接管其它请求。服务仍在处理但尚未返回的分配无法由一次查询排除，有限寿命约束这种未知状态；查询或销毁失败与原始创建失败一并报告。

服务必须在销毁成功响应前终止实例及其进程，provider 才能将该响应作为回收确认。只返回异步删除受理或控制对象消失的服务不满足该契约，须在服务接入验收时验证；调用方声明 runtime 字符串不能替代这项证据。

命令经原生 argv 执行，shell 明确为 `bash -lc`；cwd、env、身份与 PATH 由 provider 归一化。非零退出返回实际 exitCode，缺失终态不能伪装成功。超时、取消或命令流中断时销毁整个实例，并等待销毁确认后结束命令；这使跨命令后台任务无法在失联后继续执行。正常命令结束保留后台服务。文件接口复用统一 transfer 语义，文本与字节不混用。

保留、暂停与复用报告 Unsupported / DestroyOnly；rootfs Before cache 见 [远端 snapshot Before cache · OpenSandbox](#远端-snapshot-driver)。受管双向进程通过下述 pipe 桥接兑现；镜像必须提供 Node.js 22 或更新版本。缺少运行时直接报错，不能退化成单次 shell。验收检查 argv 注入、非零退出、二进制与目录往返、超时及取消后实例不可访问、创建后初始化失败回收、独立实例隔离和凭据不进入 sandbox。

## 受管进程

交互 adapter 使用 execd 的 `/pty` WebSocket pipe 模式，不能使用会合并 stderr 或回显输入的 PTY 模式。provider 通过同源 server proxy 取得 endpoint 和认证 header；连接地址必须与控制服务同源，不把控制凭据转交第三方 endpoint。

镜像内 Node 24 作为 provider 的字节桥接运行时。桥接进程启动独立 process group 的目标 argv，stdin 协议显式区分写字节、关闭 stdin 和 terminate；stdout/stderr 以 base64 frame 分离传输。每次写入确认在目标 stdin 的 write callback 后返回，EOF 在 end callback 后确认。桥接协议不进入公开 API，也不把 stdout 当作 JSONL 文本命令输出来重新分词。

目标退出或 terminate 后，桥接先 KILL 同一 process group，并从 Linux procfs 确认没有非 zombie 成员，再发布目标 exitCode/signal。确认超时、桥接错误、WebSocket 意外关闭或缺少完整终态时退休整个 Sandbox。正常完成后删除 PTY session；资源关闭可重入，失败必须保留 Provider finalizer 失败事实。Node 缺失时返回明确启动失败，不能报告交互能力已经可用。

## 远端 snapshot driver

协议与 core 的捕获步骤见 [远端 snapshot Before cache](../remote-snapshot-cache.md)。OpenSandbox driver 交出的原语：

- **driver**：`preserves = { disks: ["/"], memory: false }`；`sourceUsableAfterSnapshot = false`。不保存进程、卷或 tmpfs。
- **Base 身份**：必须是 digest-pinned image，否则 `Ineligible(base-image-unverified)`。
- **execution domain**：规范化服务 URL 与凭据的不可逆摘要；URL 路径、目标平台与 Provider 的 `cacheFormat` 进入 key scope。
- **createSnapshot / findSnapshot / deleteSnapshot**：公开 Snapshot API，按 `name` 创建与精确查询。
- **createFromSnapshot**：从 snapshotId 创建实例；remote handle 原子替换 backend，清空用户身份与 PATH 等实例缓存后重新执行宿主初始化，不保留旧实例引用。
- **回收边界**：Snapshot 删除不保证回收 Kubernetes registry blobs。registry retention 与容量监控属于部署方，NiceEval 不持有 registry 写凭据。
