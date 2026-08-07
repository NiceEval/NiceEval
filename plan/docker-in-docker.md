# Docker Profile / 单容器 DinD 实施树

契约单源是 `docs/roadmap/docker-profiles/`。本文件只描述实现依赖、并行边界和验收，不复述或修改目标契约。
实施终点是：NiceEval-Eval 确实通过当前 NiceEval 工作树运行单容器 DinD；全部硬门槛有原始证据；契约从 Roadmap 并入 Feature；NiceEval 实现 PR 可审查、可复现。

## 已核对的起点

- 当前公开面仍是 `dockerfileSandbox()` / `dockerImageSandbox()`，尚无统一的 `dockerSandbox({ source })`。
- `src/sandbox/docker.ts` 已有 `privileged: "rootless"`、容器资源映射和基于环境变量的临时校验，但尚无 profile registry、control protocol、持久 watchdog、跨进程 admission 或 daemon generation 绑定。
- CLI 尚无 `niceeval docker profile list|doctor`；仓库也没有 NixOS module、通用 systemd host package 或 macOS 专用 VM package。
- `docs/feature/sandbox/` 已描述一部分 privileged/resources 行为，并仍声明“没有 profile registry”。实现完成时必须按 Roadmap 重写该处，不能保留两份冲突契约。
- `/home/ctrdh/Code/NiceEval/NiceEval-Eval` 已有 `sandbox/Dockerfile`、DinD entrypoint 和未提交的 DinD 实验改动；这些改动属于用户或其它 agent，实施者不得覆盖、回退或顺手提交。
- NiceEval-Eval 当前 `node_modules/niceeval` 指向 `/home/ctrdh/Code/NiceEval/NiceEval`，不是本工作树。真机验收前必须重新链接，并用解析后的绝对路径证明链接目标。
- NiceEval 直接从 TypeScript 源码运行；只有 `src/report/**` 是预编译运行时面。下游验收若触及报告，先执行 `pnpm run build:report`，且每次 `pnpm install` 后重新核对链接。

## 标记

- `[P]`：只要依赖已满足，可与同层其它 `[P]` 节点并行。
- `[S]`：串行汇合点；其依赖全部验收后才开始。
- `[X]`：需要真实 Linux/rootless/privileged、systemd、VM 或真实下游，不能用 fake 宣称通过。
- 每个源码节点先在 `docs/engineering/testing/unit/sandbox.md` 声明对应覆盖类别，再写测试；真实 Docker、进程、cgroup、socket 和模型协作只在 E2E/真机层证明。

## 树形 TODO

- [ ] **R. 固定实现契约与文件所有权** `[S]`
  - [ ] 以 `docs/roadmap/docker-profiles/{library,cli,architecture,lifecycle}.md` 和 `use-case/niceeval-eval.md` 为唯一目标，逐项建立“契约 → owner → 证明”的核对表。
  - [ ] 冻结 v1 descriptor、control protocol、lease、reservation、build operation、错误码和 JSON 输出形状；实现不得从现有临时环境变量方案反推或削弱 Roadmap。
  - [x] 资源算术已裁决：保持每容器 4 CPU；四路 allocatable/aggregate 至少 16/20 CPU，八路至少 32/40 CPU，并分别声明 memory/PID 与 recovery headroom。
  - [x] outer 网络契约已裁决：每个 Attempt 独占 user-defined bridge，可出站 NAT，但 sibling、宿主 loopback/control endpoint、默认 bridge、published port、host network/host gateway 全部隔离；network 与 container 同组 journal-first 回收。
  - [ ] 为下面每个并行节点分配不重叠的文件所有权；`src/cli.ts`、`src/sandbox/layer.ts`、`src/sandbox/runtime.ts`、`src/runner/run.ts` 等共享入口只由对应汇合节点接线。
  - [ ] 记录 NiceEval 与 NiceEval-Eval 两个仓库的初始 `git status`、HEAD、现有未知改动和当前链接目标，作为后续范围审计基线。
  - 验收：每条 Roadmap 声明恰好有一个实现 owner 和至少一种证明；不存在“以后补宿主包/恢复协议”的空节点。

  - [ ] **A. 公共 factory、规范化与身份** `[P]` `⇐ R`
    - 所有权：`src/sandbox/layer.ts`、`src/sandbox/index.ts`、`src/sandbox/identity.ts` 及窄测试文件。
    - [ ] 新增统一 `dockerSandbox({ source })`；`source` 是 image / Dockerfile 穷尽联合，Compose 仍走独立 factory。
    - [ ] 实现 profile 分支的类型与运行时约束：非空 alias、rootless privileged 必须带 profile、profile 必须带完整 CPU/memory/PID/read-only rootfs。
    - [ ] 完整规范化 tmpfs 路径、mode、uid/gid、`executable` 与数值边界；默认 `nosuid,nodev,noexec`，只有显式 `executable` 才开放执行。
    - [ ] 将 source、privileged、resources、readiness command/user 与 semantic policy revision 放入正确 identity；timeout/interval、alias、stable ID、endpoint/generation 不进入可分享 fingerprint。
    - [ ] 删除旧 image/Dockerfile 双入口及临时兼容层，不保留同一能力的两套公共 API。
    - 验收：`pnpm test src/sandbox/layer.test.ts src/sandbox/*identity*.test.ts`；`pnpm run typecheck`；类型 fixture 证明非法组合无法表达，运行时畸形输入给稳定错误码。

  - [ ] **B. Profile 数据、registry 与只读解析** `[P]` `⇐ R`
    - 所有权：新增 `src/sandbox/docker-profile/{schema,registry,errors}.ts` 及对应测试。
    - [ ] 实现 callback-free v1 descriptor、严格 schema、语义 policy revision 重算与 canonical digest。
    - [ ] registry 按 alias 唯一解析 stable profile ID；拒绝 symlink、错误 owner/mode、可写父目录、重复 ID 和歧义 selector。
    - [ ] transport/backend 两套 machine identity 分开建模；只接受 Unix transport 和内置 security level，不执行 descriptor 提供的 callback/命令。
    - [ ] 输出层对 socket、UID、data-root、lease token 等私密本机事实做类型级隔离，防止进入 Record/JSON。
    - 验收：无网络/无 Docker 的表驱动单测覆盖合法 descriptor、权限/父目录、symlink、重复/歧义和未知 schema/security level；`pnpm test` 对应切片通过。

  - [ ] **C. Control protocol 与持久 watchdog 内核** `[P]` `⇐ R`，协议形状与 B 共用已冻结契约
    - 所有权：新增独立 control/watchdog 模块及其 journal/state-machine 测试；不接触 Provider/CLI 接线文件。
    - [ ] 实现认证 challenge、descriptor digest/profile ID/machine identity/daemon generation 的 attestation 响应。
    - [ ] 实现 crash-safe Invocation lease、心跳、draining/lost/recovered 状态与 token 所有权；PID 只作诊断，不能单独授权接管。
    - [ ] 实现 container/build reservation 的原子公平队列和容量向量校验；取消排队不留槽，无法证明释放时继续占用。
    - [ ] 实现 managed build proxy：持久 build operation、BuildKit session、provisional ref、取消与终止证据齐备后再释放 slot。
    - [ ] 实现 journal-first 资源状态机、labels 对账、kept 排除、CLI 断连自动恢复、watchdog restart 重建和 daemon generation 失效广播。
    - [ ] 所有清理只凭 profile ID + Invocation UUID + provision token + journal/label 完整匹配；304/404 幂等，其它错误保留责任和占用。
    - 验收：确定性状态机/崩溃点/竞态单测证明不超卖、不双持有、不误删、不提前放槽；真实 `SIGKILL` 与 Docker 回收留给 J/L。

  - [ ] **D. Linux 宿主部署包** `[P][X]` `⇐ B、C`
    - 所有权：新增 NixOS module、通用 systemd host package、sysusers/tmpfiles/unit/安装事务与宿主 doctor 支撑资产；不修改 core Provider。
    - [ ] NixOS module 从声明生成 dedicated UID/GID、subuid/subgid、root-owned descriptor、socket ACL、bounded filesystem、aggregate cgroup、daemon/watchdog units。
    - [ ] systemd package 支持管理员提供的独立 filesystem/LVM/ZFS/loop-backed ext4，并拒绝普通根分区子目录或只有告警没有硬上限的存储。
    - [ ] 安装/升级/移除使用 journal 事务；只收养 identity 完全匹配的既有资源，删除 data 必须二次精确确认。
    - [ ] 保证 rootlesskit/dockerd/containerd/buildkit/shim/outer scope 都是 aggregate cgroup 的严格后代，daemon 只监听受管 Unix socket。
    - 验收：NixOS VM test 从零 build、rebuild、reboot、uninstall；真实 systemd Linux 从零安装、失败回滚、reboot recovery；两者都跑 doctor smoke 和 nested Docker。

  - [ ] **E. macOS 专用 VM package** `[P][X]` `⇐ B、C`
    - 所有权：macOS/launchd/VM provisioning 与 host transport 资产；不修改 Linux package 或 core Provider。
    - [ ] 创建 bounded disk 和稳定 guest identity；guest 内复用 Linux dedicated UID/cgroup/daemon/watchdog 契约。
    - [ ] host 侧建立受认证的 Docker/control Unix transport，并绑定 host/guest machine identity。
    - [ ] launchd 管理 boot/reboot/recovery；明确拒绝把共享 Docker Desktop VM升级成 managed privileged profile。
    - 验收：干净 macOS 安装、重启、doctor smoke、nested Docker、双 Invocation admission 与 CLI `SIGKILL` 自恢复；卸载不误删非本 package 资源。

  - [ ] **F. Profile client、attestation 与物理执行域** `[S]` `⇐ A、B、C`
    - 所有权：新增 `src/sandbox/docker-profile/{client,attestation,lease}.ts`，接线 `src/sandbox/{plan,runtime,layer}.ts`。
    - [ ] discovery/link/user selection 保持纯；只为最终选中的 pair 收集 alias，随后在任何 Docker I/O、build 和模型调用前 load/attest/create lease。
    - [ ] 将 endpoint、profile ID、policy revision、generation 绑定到 ProviderPlan；同一 Sandbox 的 discovery/build/create 全程不能换 daemon。
    - [ ] 增加私有 `DockerMaterializationDomain(profileId,generation)`；build realization、single-flight 与 Sandbox pool 按 domain 隔离，但 domain 不污染 BuildKey/fingerprint。
    - [ ] 每次 build/create 前重新核对 profile ID/generation；generation 改变即停止派发并形成 environment incomplete，不自动重跑已产生成本的 Attempt。
    - [ ] `check` / `--dry` 完成 attestation、短 lease 和静态容量可行性检查，但不 build/create。
    - 验收：fake 自有 control client 的组合测试证明未选 profile 零 I/O、选中 profile 先 attest 后 Docker、跨 daemon 不复用、generation 改变停止派发。

  - [ ] **G. Docker Provider、readiness 与资源生命周期** `[S]` `⇐ F`
    - 所有权：`src/sandbox/{docker,dockerfile-build,build-coordinator,registry,orphans}.ts` 及窄测试。
    - [ ] 删除 `NICEEVAL_ROOTLESS_DOCKER_*` 临时 attestation 与默认 socket 推断；受管分支只使用 F 绑定的 client/domain。
    - [ ] build 经 watchdog reservation/proxy；create 先取得完整资源 reservation，再以 labels + provision token 创建并 commit container ID。
    - [ ] HostConfig 精确兑现 NanoCpus、Memory、MemorySwap=Memory、PidsLimit、ReadonlyRootfs 和 tmpfs flags；禁止 outer socket、control socket、host gateway 与 lease token 注入。
    - [ ] start 后以作者声明 user 重试 readiness；readiness 前不运行 lifecycle setup/prepare/agent，失败走独立 cleanup signal 和 watchdog destroy intent。
    - [ ] rootless privileged capability 恒为 DestroyOnly；普通 Docker/Compose 既有行为、keep/orphan 语义不回归。
    - [ ] detached registry 保存 stable profile ID；`sandbox list|enter|stop|prune` 按 ID 重连并重新 attest，找不到时拒绝回退默认 daemon。
    - 验收：Provider 单测 + `pnpm e2e --group sandbox`；真实资源/cgroup/socket 与强杀行为由 J/L 证明，fake Docker inspect 不能替代。

  - [ ] **H. CLI、反馈与稳定 JSON** `[P]` `⇐ B、C`；运行接线最终 `⇐ F、G`
    - 所有权：新增 profile CLI 模块、`src/cli.ts` 单点接线、i18n/help/reference 生成面。
    - [ ] 增加 `niceeval docker profile list [--json]`，只读 registry，不导入项目、不探测默认 Docker。
    - [ ] 增加 `doctor <alias> [--smoke] [--json]`；逐项检查 descriptor、endpoint peer/inode、daemon owner/rootless、generation/data-root、cgroup 后代、watchdog/journal/reservation。
    - [ ] `--smoke` 创建有硬限额的短命 privileged probe，读取真实 cgroup 文件、运行 inner Alpine，并证明所有资源与 reservation 消失。
    - [ ] 明确不实现 `docker ... -- <command>` 或 profile exec 代理。
    - [ ] human plan 与 JSON 只发布允许的 profile 摘要；错误包含稳定 code、声明位置、alias、失败事实和 doctor 下一步，不泄漏 token/本机敏感路径。
    - 验收：CLI 解析/格式化单测、`pnpm run niceeval -- docker profile ...` 冒烟、生成参考文档一致；真实 doctor smoke 在 J/L。

  - [ ] **I. NiceEval-Eval 单容器 DinD 题面与本工作树链接** `[P]` `⇐ A`；真实运行 `⇐ D、F、G、H`
    - 所有权：仅 `/home/ctrdh/Code/NiceEval/NiceEval-Eval` 中明确列出的 DinD 文件；先审计并保留其现有未提交改动，不把它们并入 NiceEval PR。
    - [ ] 将 `experiments/shared.ts` 收敛到 `dockerSandbox({ source, profile: "default", privileged: "rootless", resources, readiness })`，统一使用一份 `sandbox/Dockerfile` 和 entrypoint。
    - [ ] 镜像固定 base digest，包含 Node 24、Python、coding-agent CLI、Docker daemon/CLI、Compose；entrypoint 只开同容器 inner Unix socket，普通 agent user 可访问。
    - [ ] 补齐 roadmap 指定四道 task-shaped Terminal-Bench 题：`broken-networking`、`debug-long-program`、`simple-sheets-put`、`sql-injection-attack`；不要用仅跑 `docker info` 的空壳题代替。
    - [ ] 不提交机器绝对路径。验收机在 NiceEval-Eval 内执行 `pnpm link /home/ctrdh/.herdr/worktrees/NiceEval/docker-in-docker`，每次 install 后重复，并断言 `readlink -f node_modules/niceeval` 精确等于当前工作树。
    - [ ] 若下游路径触及 report，先在当前工作树执行 `pnpm run build:report`；然后在下游执行 `pnpm run typecheck`、`niceeval list`、目标 `--dry --json`。
    - 验收：解析到的 package、CLI 入口和 source map 都来自当前工作树；链接证明、HEAD、命令和退出码进入验收证据；不得以“两个 checkout 当前碰巧同一 commit”代替链接证明。

  - [ ] **J. Linux 真机故障矩阵** `[S][X]` `⇐ D、F、G、H、I`
    - [ ] 单路证明 uid 1000、Node 24、inner Docker/Compose/Alpine、只读 rootfs、每个 tmpfs 容量、真实 cgroup 四项、aggregate 后代关系和 outer/control socket/host gateway/token 不可见。
    - [ ] 两个独立 CLI 同时各跑 task-shaped Attempt；采集 lease/reservation 时间线，证明同时 active、公平排队、容量总和不超卖、一个结束不删另一个。
    - [ ] 四路矩阵包含 passed、failed、timeout、Ctrl+C、主动 abort、OOM、PID storm、填满 tmpfs；sibling 必须继续，cleanup p95 在 Runner 看门狗边界内。
    - [ ] 四路必须有四个 outer container 同时处于 active 并各自持有完整 reservation；排队后依次完成不算四路并发。以 R 已裁决的 allocatable CPU 和 headroom 为准核对资源算术。
    - [ ] 在 container create/readiness、Dockerfile build 两种时点分别 `SIGKILL` CLI；不运行第二个 doctor/exp 触发清理，等待 watchdog 自行取消/删除/释放，再用 doctor 只读核对。
    - [ ] `SIGKILL` watchdog，确认 systemd 重启后从 journal 重建且不误删 active sibling；restart daemon，确认旧 Invocation 停止派发并报告 incomplete，新 Invocation 在恢复后可用。
    - [ ] 正常/错误/强杀后都证明 outer container、inner process/mount、BuildKit session、provisional ref 和 reservation 无残留，installed daemon/data mount仍在线。
    - 验收：保存原始 CLI 输出、JSON、journal、Docker labels、process/cgroup 路径、资源前后快照和精确退出码；只看 Docker HostConfig 或 mock 输出不算通过。

  - [ ] **K. 八路容量晋升** `[S][X]` `⇐ J`
    - [ ] 在与四路相同的题目、故障矩阵和证据采集下运行 8 个 outer scope；先保持 Experiment 更高并发由 admission 限流，再调整宿主 `maxContainers: 8`。
    - [ ] 证明 aggregate CPU/memory/PID/disk/build headroom 仍满足，所有 scope 都是 aggregate 严格后代，无 swap、无超卖、无 sibling 击穿。
    - [ ] 只有实测通过后才把 NiceEval-Eval 的 `EVAL_MAX_CONCURRENCY` 从 4 上调；否则保持 4 并把失败作为未完成硬门槛。
    - 验收：四路/八路对比包含吞吐、排队、公平性、峰值资源、cleanup p95 和失败分类；不能只凭“8 条最终都结束”通过。

  - [ ] **L. 三种宿主共同兼容性** `[S][X]` `⇐ D、E、J`
    - [ ] NixOS VM、真实 systemd Linux、macOS 专用 VM 都由同一 core 读取 v1 descriptor/control protocol，下游配置不按 OS 分支。
    - [ ] 三者分别完成 install/reboot/doctor/nested Docker/双 Invocation/CLI SIGKILL；macOS 另证 host/guest identity，Linux 另证真实 aggregate cgroup 与 bounded filesystem。
    - [ ] external/remote profile 至少验证拒绝不完整 attestation；只有 endpoint/TLS/`docker info rootless` 不得升级 security level。
    - 验收：三份环境矩阵全部通过；任何一项缺证据时不得把 Roadmap 整体提升为 Feature。

  - [ ] **M. 全仓回归、契约晋升与 PR 收口** `[S]` `⇐ A–L`
    - [ ] 运行 `pnpm test`、`pnpm run typecheck`、`pnpm e2e --group sandbox`；改了 report 时先 `pnpm run build:report`；改公开 CLI 后运行参考文档生成与 `pnpm test:docs-site`。
    - [ ] 将 `docs/roadmap/docker-profiles/` 的最终契约按 owner 并入 `docs/feature/sandbox/` 的 library/cli/architecture/lifecycle/use-case，删除 Roadmap 入口和目录，不复制第二份定义。
    - [ ] 重写 Feature 中“没有 profile registry”和临时环境变量 attestation 等旧声明；同步 `docs/source-map.md`、Feature/roadmap 索引、测试覆盖规范和公开文档。
    - [ ] 运行 `pnpm test:docs`、`pnpm test:docs-site`，并核对 roadmap 名称、旧 factory、旧环境变量和冲突声明无残留。
    - [ ] 审计两个仓库 `git status` 与 diff；NiceEval PR 只含授权实现/文档/测试/部署资产，不携带 NiceEval-Eval 的既有未知改动或验收产物。
    - [ ] PR 描述附命令、环境、HEAD/link 证明、四路/八路、双 Invocation、SIGKILL/restart、三宿主结果和未通过项；任一硬门槛未过则保留 Roadmap，不宣称 Feature。

## 并行关系

```text
R
├─ A ───────────────┐
├─ B ──┬─ D ───────┼───────────────┐
│      ├─ E ───────┼───────────┐   │
│      └─ H(前半) ─┤           │   │
└─ C ──┴────────── F ── G ─────┼─ J ── K ──┐
                    ├─ H(接线) ─┘           │
A ── I(题面/链接) ──┘                       ├─ M
D/E/J ────────────────────────────── L ─────┘
```

- 第一批可并行：A、B、C。
- B/C 合流后，D、E 与 H 的只读 CLI/输出层可并行；F 负责唯一的 planner/runtime 接线。
- G 只在 F 完成后改 Docker Provider；I 可先整理下游题面和链接方式，但付费/真机运行必须等待 D/F/G/H。
- J 是 Linux 汇合验收；K 严格串在 J 后。L 汇合 Linux 与 macOS。M 是唯一晋升与 PR 收口节点。

## 验收判定

| 证明面 | 可以由单测证明 | 必须真实执行 |
|---|---|---|
| schema、alias、权限规则、identity/fingerprint、状态机转换、容量算法、错误码/JSON | 是 | 否 |
| Docker API 调用顺序、未选 profile 零 I/O、generation 失效后的 runner 决策 | fake 自有 client 可证明 | 真实 restart 仍要复验 |
| rootless/privileged 边界、cgroup 硬限额、bounded filesystem、socket 不可见 | 否 | Linux/VM doctor + probe |
| inner Docker/Compose、四道真实题、两个 Invocation、4/8 路吞吐 | 否 | NiceEval-Eval 真机 |
| CLI `SIGKILL` 后无下一次命令的自动回收、BuildKit 取消、watchdog/daemon restart | 否 | 持久 watchdog 真机 |
| NixOS/systemd/macOS package 的安装、重启、回滚和卸载边界 | 否 | 三种宿主环境 |
| Roadmap → Feature | 否 | 上述全部通过后才允许 |

最终通过条件是“证据同时成立”，不是某一条测试命令为绿：当前工作树链接无误；单路 DinD 真工作；跨进程不超卖；强杀后 watchdog 自恢复；三种宿主兑现同一协议；8 路在硬配额内通过；文档、源码、测试和公开读面无冲突。
