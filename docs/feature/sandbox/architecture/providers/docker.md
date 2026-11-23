# Docker Provider —— 架构

本地 Docker Provider 的实现。公开用法见 [Docker](../../library/providers/docker/README.md)；所有 Provider 共用的契约见 [Architecture](../README.md)。

## 实例与命令

最常用、最便宜:无需任何云 token,本地有 Docker 即可。要点:

- **保活容器** —— 用 `node:24-slim` 起一个 tail 日志文件的长生命周期容器,后续命令用 `docker exec` 进去跑(`AutoRemove` 在 stop 时移除)。
- **执行身份沿用镜像声明** —— 默认以镜像 `USER` 声明的用户跑命令(未声明按 Docker 语义是 root);factory `user` 替换整个 Sandbox 的默认身份,命令传 `{ user: "root" }` 时只这一条换身份(见 [Library · 执行身份](../../library/README.md#执行身份))。npm 全局目录与 `PATH` 注入按实际执行身份的 home 定位,不硬编码 UID。
- **slim 镜像补全** —— `apt-get install ca-certificates git`(slim 不带)。
- **文件上传** —— 用 tar 打包 `putArchive` 进容器,随后 `chown` 到执行身份修正属主(putArchive 以 root 写入)。
- **多路复用流** —— Docker 的 exec 流把 stdout/stderr 复用在一条流上(8 字节头 + payload),需要按帧拆分。
- **超时** —— 命令到点销毁流并报错;上限按[时限归属](../README.md#命令时限与实例寿命)从 attempt deadline 派生。

这条路径不把 Docker API 交给 Agent。
Agent 需要 `docker` / `compose` 时走 [Nested Docker](../../../sandbox-nested-docker/README.md) 的 Incus VM。
`dockerAccess` socket / DinD 不是 adopted nested-Docker public path。

```typescript
const sandbox = await createSandbox({ provider: "docker", runtime: "node24", timeoutMs });
for (const file of workspaceFiles) await sandbox.writeBytes(file.path, file.content);
await sandbox.runCommand("npm", ["install"]);     // cwd 省略 → workdir
```

## Compose case

Docker provider 直接把任务 Compose 当原生运行时输入,不先编译成 NiceEval 的 services 词汇。
NiceEval 只生成必要的 overlay:

- 标记或补出 `workspaceService`;
- 注入 attempt 身份、受管目录与凭据引用;
- 应用资源上限和网络策略;
- 为收尾、孤儿核对与留存写 project label。

启动前先按 BuildKey 执行 `docker compose build`,命中 BuildKit cache 时只做增量核对;随后 `docker compose up --detach --wait`。
Compose 自己处理 `depends_on`、healthcheck、网络 DNS、`extra_hosts`、volume 与逐服务构建。


未知 Compose 字段不因 NiceEval parser 没见过就拒绝。
真正破坏核心不变量的字段由 Docker case 明确列黑名单；错误必须在 physical planning 点名字段与理由,早于携带、构建和资源创建。

黑名单包含以下声明：

- 让 main 容器脱离受管网络、替换受管 workdir,或让任一 service 挂载 Docker socket；
- 为任一 service 声明固定 `container_name`；
- 让非 `external` 的 network、volume、config 或 secret 使用不随 Compose project 变化的全局名称；
- 顶层 `include`,以及任意 `services.*.extends.file`。

命名空间检查以 Compose 合成后的有效模型为准,涵盖同文件 anchor、merge、插值与 service extends。
Provider 用两个不同的哨兵 project 求值同一份 file 与 env；受管资源的有效名称必须在两份模型中分别按 `<project>_<logical-key>` 变化。

完整模型只驻留规划内存,不落盘、不进入日志或错误正文,避免展开后的 credential env 值泄漏。
无法取得有效模型或解码其 JSON 时规划失败,不能跳过检查。

`external: true` 明确表示资源不归本 Case 创建和回收,因此保留其外部名称。
Compose 的第二文件入口不属于当前 CaseKey 的输入闭包；`include` 与任意 `extends.file` 必须拒绝,不能读取后仍用主文件身份携带结果。同文件复用用 anchor、merge 或不带 `file` 的 service extends。

`dns`、`extra_hosts`、自定义 networks 与 sidecar 隔离可以直接构成题目语义,Docker case 不把它们归一化掉。
Agent 只能进入 main 容器;sidecar 文件系统只经题目网络交互或受控的判分采证接口可见——把 sidecar 合并进主 Sandbox 会改变题目,不属于合法降级。

主容器进入 ready 后才交给 Agent;判分完成前整组保持存活。
任一必需服务提前退出时，Attempt 形成 `errored` Verdict，并附服务状态与日志的 Observability，不折叠成 Agent 行为的 `failed` Verdict。
收尾按 case 自己的资源句柄执行 `compose down`;部分启动、中断与超时同样走整组 finalizer。

逐服务日志由 `ServiceController` 取得并按有界 command / diagnostics 进入 Observability；需要保留的大型具类型捕获才进入 Artifacts。Artifact 声明只引用主 Sandbox 时所有 provider 都能运行,引用 sidecar 时启动期要求 `services` 能力并校验服务名存在。

## Provisioning 对账与重试

通用分类与两道防线见 [Architecture · Provisioning 失败与重试](../README.md#provisioning-失败与重试)。Docker 与 Docker Compose 的对账通道与重试面：

- **Docker** —— 容器创建时即带 provision token label(与留存候选的 `niceeval.keep-candidate` 标签同一机制),对账 = 按 label 查询本地容器、force remove(容器已不存在视作对账完成)。create 闭包在容器创建后还有 start、基础工具安装、工作区属主一串 exec,这些步骤失败由 kill-on-failure 直接 force remove。拒绝类主要是拉镜像限流(发生在容器创建之前)。
- **Docker Compose** —— build 与 up 都复用同一套瞬时分类和退避。build 以同一 BuildKey 重建即可收敛。
- up 的 projectName 与 overlay 在整个重试闭包内固定，每次重试前先对同一 project 执行独立于 Attempt signal 的有界 `compose down --volumes --remove-orphans`，清掉半启动服务后再 up。
- 附着主服务后由 Docker provider 探测分类账所需的 git；题目镜像没带时以 root 通过已有的 apt/apk/dnf/yum 补齐，而不是要求每条 Eval 修改 Dockerfile。
- 整个 case 最终仍由主实例及伴随资源的 finalizer 回收；即使前向工作已经 timeout/cancel，finalizer 也拿新的 8s cleanup signal。
- 只有真实回收成功才解除 registry 所有权；失败追加 `sandbox-stop-failed` Observability diagnostic、保留 project labels 供同轮强清重试或原生 CLI 工具事后回收，不改写原 Attempt 的 Verdict。

## Cache inventory projection

Docker cache repository 以单个只读 inventory operation 在同一 transaction snapshot 中列出 task-build 与 before-cache entry 及其 active lease 与 hold。该 operation 不做 startup reconcile、lease prune、provider mutation 或 GC planning。Docker administration 再复核 task-build image identity，并把两类 entry 投影为以 `kind` 判别的公开联合；Before cache 只采用 registry 已有 state，不因 inventory 改变 generation 或索引。

公开 identity 只包含定位 artifact 所需的 task build key/tag/image id，或 before-cache entry id/key/image/base image id；计数只聚合 entry-local lease 与 hold。holder、operation lineage、声明正文和 GC lock 留在 repository 内部。Before cache 的公开归属不扩大 GC：现有 task-build plan/apply 是唯一删除入口。
