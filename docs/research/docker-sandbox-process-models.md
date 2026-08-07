# Docker / Agent Sandbox 进程模型：Harbor 与可比框架

> 观察日期：2026-08-07
>
> 观察对象：Harbor Framework、Inspect AI、SWE-ReX、SWE-bench、Docker Agent eval、Docker Official Image `docker:dind`
>
> 文档性质：外部产品研究与产品建议，不是 NiceEval 目标契约

## 研究判断

“启动一个空转进程，再用 `docker exec` 执行任务”是评测框架中的常见做法。
Harbor 的本地 Docker、Inspect AI 的自动 Compose 和 SWE-bench 都采用 `sleep` 或 `tail` keeper。
它们通常以新值替换镜像 `CMD`、保留 `ENTRYPOINT`，因此隐含要求已有 entrypoint 接受并最终执行新命令。

这项要求不是 Docker 的必然约束。
它只是框架选择“保留 entrypoint、注入 command”之后产生的兼容性条件。
Harbor 的 Modal DinD 路径直接继承 `docker:dind` 启动命令，SWE-ReX 让执行服务器成为主进程，Docker Agent 则由框架自己的 entrypoint 直接启动 Agent。

官方 `docker:dind` 默认启动已经足以支撑“daemon 作为主工作负载，随后 exec Agent 命令”。
严格说，官方脚本会注入 `docker-init` 作为 PID 1，再由它监管 `dockerd`。
NiceEval 不必为了让 daemon 与后续命令共存，要求下游镜像另写一个“后台启动 dockerd，再 `exec "$@"`”的 entrypoint。

NiceEval 的 TTL dead-man、Agent 日志进入 `docker logs`、DinD socket 改权是三个独立问题。
把它们全部写入用户镜像 entrypoint 是一种实现组合，不是 Docker 硬约束，也不是样本框架的共同做法。

本文用以下标记区分证据强度：

- **事实**：官方文档或固定 commit 源码直接可见。
- **推断**：由 Docker 语义与源码组合得出，但不是该产品声明的契约。
- **未确认**：源码不足以证明，仍需维护者说明或实跑。

## 一手材料、版本与名称边界

本文所说的 Harbor 是 [Harbor Framework](https://github.com/harbor-framework/harbor/tree/66af0501016cb69dd1bb186010d7b02632c7f63b)，即 Terminal-Bench 团队维护的 Agent 评测与优化框架。
它不是同名的 [CNCF Harbor 镜像仓库](https://github.com/goharbor/harbor)。
后者解决镜像托管、签名与复制等问题，不属于本研究的可比对象。

| 对象 | 观察版本 | 本文采用的一手材料 | 可比边界 |
|---|---|---|---|
| Harbor Framework | `66af0501` | [Docker environment](https://github.com/harbor-framework/harbor/blob/66af0501016cb69dd1bb186010d7b02632c7f63b/src/harbor/environments/docker/docker.py)、[keeper Compose](https://github.com/harbor-framework/harbor/blob/66af0501016cb69dd1bb186010d7b02632c7f63b/src/harbor/environments/docker/docker-compose-prebuilt.yaml)、[Modal environment](https://github.com/harbor-framework/harbor/blob/66af0501016cb69dd1bb186010d7b02632c7f63b/src/harbor/environments/modal.py) | 直接的 Agent benchmark / eval 框架 |
| Inspect AI | `f10dc46f` | [Sandboxing 指南](https://github.com/UKGovernmentBEIS/inspect_ai/blob/f10dc46f20df0738a9acbfb4c4be0bd3d60601ed/docs/sandboxing.qmd)、[自动 Compose](https://github.com/UKGovernmentBEIS/inspect_ai/blob/f10dc46f20df0738a9acbfb4c4be0bd3d60601ed/src/inspect_ai/util/_sandbox/docker/config.py)、[Docker sandbox](https://github.com/UKGovernmentBEIS/inspect_ai/blob/f10dc46f20df0738a9acbfb4c4be0bd3d60601ed/src/inspect_ai/util/_sandbox/docker/docker.py) | 通用模型评测框架内的 Docker sandbox |
| SWE-ReX | `5c995c36` | [Docker deployment](https://github.com/SWE-agent/SWE-ReX/blob/5c995c365dfb1fd5bc56fda688be5d8538f9931f/src/swerex/deployment/docker.py)、[运行说明](https://github.com/SWE-agent/SWE-ReX/blob/5c995c365dfb1fd5bc56fda688be5d8538f9931f/docs/usage.md) | Agent 命令执行 sandbox 与远程服务，不负责完整 eval Record 模型 |
| SWE-bench | `f7bbbb2c` | [容器创建](https://github.com/SWE-bench/SWE-bench/blob/f7bbbb2ccdf479001d6467c9e34af59e44a840f9/swebench/harness/docker_build.py)、[评测执行](https://github.com/SWE-bench/SWE-bench/blob/f7bbbb2ccdf479001d6467c9e34af59e44a840f9/swebench/harness/run_evaluation.py) | benchmark harness；执行预测 patch 与测试，不在容器内驱动通用 Agent loop |
| Docker Agent eval | `617548ea` | [Evaluation 文档](https://github.com/docker/docker-agent/blob/617548ea5b7e7637a251ecc4a5cd0a7bc33e7e91/docs/features/evaluation/index.md)、[派生镜像模板](https://github.com/docker/docker-agent/blob/617548ea5b7e7637a251ecc4a5cd0a7bc33e7e91/pkg/evaluation/Dockerfile.custom.template)、[运行器](https://github.com/docker/docker-agent/blob/617548ea5b7e7637a251ecc4a5cd0a7bc33e7e91/pkg/evaluation/eval.go) | Docker 官方 Agent 的 eval runner；Agent 本身就是容器主工作负载 |
| Docker Official Image | `3289af88` | [`29/dind` Dockerfile](https://github.com/docker-library/docker/blob/3289af88086d67e6f0bfebfa0617541a0f574d96/29/dind/Dockerfile)、[`dockerd-entrypoint.sh`](https://github.com/docker-library/docker/blob/3289af88086d67e6f0bfebfa0617541a0f574d96/29/dind/dockerd-entrypoint.sh) | Docker 语义与 DinD 参照实现，不是评测框架 |

固定 commit 用于复核观察日源码。
Docker CLI 与 Compose 的通用语义另以观察日的官方 [Dockerfile reference](https://docs.docker.com/reference/dockerfile/) 和 [Compose services reference](https://docs.docker.com/reference/compose-file/services/) 为准。

## 进程模型对照

| 框架 | 启动时怎样处理镜像配置 | 怎样保持 sandbox 存活 | Agent / task 怎样执行 | DinD | 镜像 entrypoint 是否必须 exec 框架 Cmd |
|---|---|---|---|---|---|
| Harbor 本地 Docker | Compose `command` 改为 `sh -c "sleep infinity"`；不设置 `entrypoint` | `sleep infinity` | `docker compose exec ... bash -c`；安装、Agent、verifier 都走 exec | Modal 有一等 DinD 路径，直接继承 `docker:dind` 默认启动 | 本地 keeper 路径需要；Modal 可由框架替换启动配置，DinD 路径不注入 Cmd |
| Inspect AI | 自动 Compose 改写 `command`，保留 entrypoint；显式 Compose 由作者决定 | `init: true` 加 `tail -f /dev/null` | `docker compose exec` | 未发现一等支持；显式 Compose 理论上可自行配置 | 自动路径需要；显式 Compose 取决于作者配置 |
| SWE-ReX | `docker run IMAGE <server command>` 替换 CMD，保留 entrypoint | `swerex-remote` 服务就是主工作负载 | 通过 HTTP `RemoteRuntime` 向服务发命令，不走 `docker exec` | 未发现 daemon 编排 | 需要 entrypoint 把 server command 传下去 |
| SWE-bench | Docker SDK `command="tail -f /dev/null"` 替换 CMD，保留 entrypoint | `tail -f /dev/null` | `container.exec_run` 应用 patch、运行测试并收集结果 | 未发现支持 | 需要 entrypoint 把 keeper command 传下去 |
| Docker Agent eval | 派生镜像明确替换 ENTRYPOINT；原 ENTRYPOINT/CMD 被忽略 | `docker-agent run` 是主进程；结束即退出 | Agent 直接作为主进程；`--keep-containers` 只保留已停止容器供调试 | `--privileged` 存在，但可用 DinD 未确认 | 不需要用户镜像配合；wrapper 由框架派生镜像拥有 |

表中的“需要”不是 Docker 对所有镜像的要求。
它只表示：当框架保留某个镜像 entrypoint，又把自己的命令放入 CMD 时，该 entrypoint 必须把参数传给真正进程，否则 keeper 或服务器不会启动。

## 各框架的真实边界

### Harbor：同一框架内已经存在两种策略

**事实。** Harbor 本地 Docker 的 Compose overlay 把 `main` 服务命令设为 `sh -c "sleep infinity"`。
Docker environment 用 `compose up --detach --wait` 启动，再用 `compose exec` 执行安装、Agent 与 verifier 命令。
这与 NiceEval 的 keeper + exec 形态最接近，但 keeper 没有内嵌 TTL，也不承担 Agent 日志聚合。

**事实。** Harbor 的 Modal 普通 Sandbox 默认把 `sleep infinity` 作为 positional entrypoint，源码明确称它替换镜像 ENTRYPOINT/CMD。
任务作者可以把 `keepalive` 设为 `None`，继承镜像原始启动命令。
这说明 Harbor 没把 wrapper 责任推给任意用户镜像；至少在该 provider 中，keeper 启动配置由框架拥有。

**事实。** Harbor 的 Modal DinD 选择 `docker:28.3.3-dind`，创建 sandbox 时不传 entrypoint。
它等待 `docker info` 成功，然后在内层 Docker 中执行 Compose，并对 `main` 服务做 `compose exec`。
源码注释明确把“继承 `dockerd-entrypoint.sh`”列为不传 entrypoint 的用途。

**边界。** Harbor provider 很多，不能从 Modal 推断所有云 provider 的 DinD 行为完全相同。
本文只把本地 Docker 与 Modal 中可直接观察的路径作为事实。

### Inspect AI：自动路径采用 keeper，显式 Compose 保留逃生口

**事实。** Inspect AI 为普通镜像或 Dockerfile 自动生成 Compose 时，都设置 `command: "tail -f /dev/null"` 与 `init: true`。
官方指南直接解释该命令用于阻止容器退出。
随后 sandbox 通过 Compose exec 执行命令，任务完成后默认 Compose down。

**事实。** 用户也可以提供完整 Compose 文件。
该路径允许作者保留服务镜像的原始 command，或自行声明 privileged、entrypoint 与多服务拓扑。

**推断。** 显式 Compose 能表达 `docker:dind`，但自动 Dockerfile 路径会改写其 CMD，阻止 daemon 默认启动。

**未确认。** 官方文档与核心 Docker provider 没有把 DinD 声明为一等能力，也没有给出经过支持的 daemon readiness、socket 权限或嵌套容器测试。

### SWE-ReX：服务进程替代空转 keeper

**事实。** SWE-ReX 执行 `docker run ... IMAGE /bin/sh -c '<swerex-remote 启动命令>'`。
这个命令替换 CMD，但保留镜像 ENTRYPOINT。
`swerex-remote` 在容器内常驻，宿主的 `RemoteRuntime` 通过 HTTP 发送后续命令。

这种模型不需要一个只为存活而存在的 `tail`，但会在镜像里增加框架服务与端口。
若原 entrypoint 不传递参数，远程服务器仍无法成为主工作负载。

**未确认。** 配置中的 `docker_internal_host` 支持部署器本身运行在 Docker 内时寻址远程服务。
这不是“给被测 Agent 提供 inner dockerd”的证据；官方源码没有展示同时监管 dockerd 与 `swerex-remote` 的路径。

### SWE-bench：可比的是 harness，不是完整 Agent runtime

**事实。** SWE-bench 创建容器时向 Docker SDK 传入 `command="tail -f /dev/null"`，再用 `exec_run` 复制和应用预测 patch、执行评测脚本。
它的命令超时逻辑还会通过另一次 exec 终止运行中的测试进程。

这个进程模型与 NiceEval 可比，但产品边界更窄。
SWE-bench harness 消费已经生成的预测，不证明同一做法适合所有交互式 Agent、流式日志或多服务任务。

**未确认。** 观察源码没有 privileged、inner daemon readiness 或 DinD 集成路径。

### Docker Agent eval：框架拥有 entrypoint 启动配置

**事实。** Docker Agent 从自定义 base image 派生 eval 镜像，复制 `/docker-agent`，并设置自己的 `/run.sh` ENTRYPOINT。
官方文档明确说 base image 原有 ENTRYPOINT 与 CMD 都被忽略。
`/run.sh` 属于生成镜像，内容最终 `exec "$@"`；用户不需要为框架改写自己的 entrypoint。

**事实。** `docker-agent run` 是容器主进程，runner 不靠后续 exec 驱动正常评测。
`--keep-containers` 只是不加 `--rm`，容器在 Agent 退出后仍是 stopped 状态，供用户后续检查。
官方文档建议用 runtime exec 检查；按 Docker 语义，exec 前还要先让 stopped 容器重新运行。

**未确认。** runner 总是传 `--privileged`，`eval.go` 的一段注释声称 `/run.sh` 会启动 dockerd。
但同一 commit 的默认与自定义 Dockerfile 模板只写了 `exec "$@"`，没有启动 daemon。
因此 privilege 和注释都不足以证明 Docker Agent eval 已支持 DinD。

## Docker 命令语义与 `docker:dind` 参照实现

### 替换 CMD 不等于替换 ENTRYPOINT

**事实。** `docker run IMAGE args...` 会以新参数替换镜像 CMD。
镜像存在 exec-form ENTRYPOINT 时，参数会附在 entrypoint 后面。
Compose 的 `command` 也只替换 CMD；`entrypoint` 是另一项独立配置。

Docker 不保证 entrypoint 会执行这些参数。
它可以忽略参数、改写参数、先启动服务后退出，或只接受特定子命令。

[Docker Official Images 一致性规则](https://github.com/docker-library/official-images/blob/01fdecf62623f274c7043f3d331512bd0fd1e2cf/README.md#consistency)建议带初始化逻辑的官方镜像支持 `docker run image sh`，并在非默认命令分支最终 `exec "$@"`。
这是官方镜像的用户体验规范，不是任意下游镜像必须满足的 Docker 契约。

因此，“保留 ENTRYPOINT、替换 CMD 为 keeper”可以对许多官方镜像工作，却不能成为无条件兼容性保证。
框架若依赖该行为，应把它作为镜像兼容条件；框架若不愿暴露条件，则应自己替换启动进程或提供继承镜像启动的模式。

### 官方 `docker:dind` 默认启动已经足够

**事实。** 观察 commit 的 `29/dind/Dockerfile` 设置 `ENTRYPOINT ["dockerd-entrypoint.sh"]` 与空 `CMD`。
当没有参数时，脚本把命令补成 `dockerd`；进入 daemon 分支后，它再注入 `docker-init --` 并最终 `exec`。

所以“官方 docker:dind 直接以 dockerd 为 PID 1”需要一个精确修正：

- 从容器生命周期看，dockerd 是主工作负载，daemon 退出会让容器结束。
- 从 Linux 进程号看，PID 1 是脚本注入的 `docker-init`，dockerd 是受它监管的主子进程。

**事实。** Harbor Modal 已经实作这条路径：保留 image command，等待 `docker info`，再进行后续 exec / Compose 操作。

**推断。** 对 NiceEval，“保留官方启动 + readiness + 后续 `docker exec`”在进程模型上已经足够。
还需要满足 privileged 或可用的 rootless 条件，并让非 root Agent 获得 inner socket 权限，但不需要后台 daemon wrapper。

## 与 NiceEval 的映射

观察日的 NiceEval Docker provider 在 [`src/sandbox/docker.ts`](../../src/sandbox/docker.ts) 中执行以下流程：

1. 创建容器时不设置 `Entrypoint`，所以保留镜像 ENTRYPOINT。
2. 把 `Cmd` 改为 `sh -c '... exec timeout <TTL> tail -F /tmp/niceeval-agent.log'`。
3. readiness、初始化、Agent 与任务命令都通过 Docker exec 执行。
4. 流式 Agent stdout 与 `appendLog` 写入日志文件，再由 PID 1 的 tail 暴露给 `docker logs`。

观察日的 DinD 真机测试在 [`src/sandbox/docker-access.docker.test.ts`](../../src/sandbox/docker-access.docker.test.ts) 中构建派生镜像。
它用自定义 entrypoint 后台启动 `dockerd-entrypoint.sh dockerd`，等待 ready，修改 socket 权限，再 `exec "$@"` 进入 NiceEval keeper。

| NiceEval 做法 | 样本中的对应 | 判断 |
|---|---|---|
| keeper + 后续 Docker exec | Harbor 本地、Inspect AI、SWE-bench | **行业常见形态**，尤其适合普通 workspace 镜像 |
| 保留 ENTRYPOINT，只替换 CMD | Harbor 本地、Inspect AI 自动路径、SWE-bench、SWE-ReX | **常见实现选择**，但带 entrypoint 传参兼容条件 |
| 在 keeper 外再包不可续期 TTL | 未在四个可比框架中发现相同组合；Harbor Modal 用 provider timeout / idle timeout | **NiceEval 特有选择**，不是 keeper 必需部分 |
| tail Agent 文件作为容器主日志 | 未在样本中发现相同组合 | **NiceEval 特有的可观测性选择** |
| DinD 后台 daemon，再 exec keeper | Harbor Modal 采用相反方式：保留 daemon 默认启动并后续 exec | **可以避免**；只在单一 PID 1 必须同时承担两种职责时才需要 wrapper |
| 要求下游 entrypoint 最终 exec NiceEval Cmd | keeper + 保留 entrypoint 的自然结果 | **产品兼容策略**，不是 Docker 必然性 |

NiceEval 与这些产品也不能完全类比。
NiceEval 需要 Attempt deadline、留存语义、标准事件和物理 Record；SWE-bench 没有交互式 Agent，SWE-ReX 没有完整 eval Record 层，Docker Agent 则让单个 Agent 进程决定整个容器寿命。

## 三个被 wrapper 混在一起的问题

### 1. TTL dead-man

**事实。** NiceEval 把 TTL 烧进 PID 1 的 `timeout`，宿主进程崩溃后容器仍会自行停止。
这比只存在于 runner 内存中的 timer 更抗父进程崩溃。

**推断。** TTL 不要求自定义镜像 entrypoint。
宿主 watchdog、provider 原生 sandbox timeout，或按到期 label 运行的独立 reaper 都能停止容器。
但只有独立于 runner 故障域的 watchdog / reaper，才与进程内 dead-man 的崩溃保证接近。

因此，可以把 TTL 移出容器主进程；代价是必须另证明确切的孤儿停止与留存行为。
“宿主可以计时”本身不等于已经替代 dead-man。

### 2. `docker logs` 聚合

**事实。** Docker exec 的 stdout / stderr 不会自动并入 [`docker logs`](https://docs.docker.com/reference/cli/docker/container/logs/) 读取的容器主进程日志。
NiceEval 用文件加 tail 显式建立了这座桥，因此 Docker UI 能看到 Agent 流。

**推断。** 若产品真相以 NiceEval 的结构化事件、exec stream 与 Record 为准，宿主可以直接聚合这些流，不需要让 keeper 做日志转发。
若必须保留“`docker logs <sandbox>` 展示 Agent 流”的调试体验，仍需某种桥接，但桥接不必属于用户 entrypoint。

可选桥接包括 provider 拥有的 logger 进程、sidecar、日志驱动，或经过验证的主进程 stdout 转发。
服务型镜像还存在取舍：让 `docker logs` 保留 dockerd / 服务原生日志，往往比用 Agent 流取代它更有诊断价值。

### 3. DinD socket 权限

**事实。** NiceEval 的测试 wrapper 在 `docker info` ready 后执行 `chown root:node` 与 `chmod 660`。
NiceEval provider 已经能以 root 执行初始化命令，并在 readiness 之后运行 exec。

**推断。** provider 可以先让官方 entrypoint 启动 daemon，再用 root exec 调整 socket 权限，或在创建时配置合适的 supplementary group。
这项初始化不要求成为 PID 1，也不要求用户镜像拥有 NiceEval wrapper。

**未确认。** rootful、rootless、Docker Desktop 与不同 `docker:dind` tag 的 socket owner / group 可能不同。
选定方案前需要真机矩阵，不能把某个 tag 中的 `node` 用户与固定 GID 当成通用事实。

## 产品建议，不是 Docker 契约

用户是否必须改写镜像 ENTRYPOINT，是产品体验选择。
Docker 只提供独立的 Entrypoint、Cmd、exec 与生命周期原语，并不要求框架把 wrapper 责任交给镜像作者。

后续设计可以评估三种 provider 自有的启动策略，而不在本文定案 API：

1. **继承镜像启动。** 保留 ENTRYPOINT 与 CMD，等待 readiness，再 exec 任务。它适合 `docker:dind`、数据库和其它长驻服务镜像。
2. **框架 keeper。** provider 内部替换启动进程，运行自己拥有的 keeper / supervisor，再 exec 任务。它适合默认 CMD 会退出的 workspace 镜像。
3. **作者显式启动。** 只有任务确实需要特殊服务拓扑时，才让作者声明自有 entrypoint 或 Compose。

即使 provider 内部选择替换 ENTRYPOINT，也不应等价成“用户镜像必须实现 `exec NiceEval Cmd`”。
Docker Agent 的派生镜像和 Harbor Modal 的 provider override 都证明，wrapper 可以由框架拥有。

对 NiceEval 最值得优先验证的方向是：

- DinD 路径继承官方 `docker:dind` 默认启动，ready 后由 root exec 做 socket 初始化，再以目标用户 exec Agent。
- 普通 workspace 仍可使用 provider 拥有的 keeper，但不要把任意镜像 entrypoint 的参数传递行为当成无条件保证。
- 把生命周期 deadline、结构化 Agent 日志和镜像主进程日志分别建模，再决定是否仍需一个进程同时承载三者。
- 若保留进程内 TTL，把它描述为 NiceEval 的 orphan 自动停止保证，而不是 DinD 或 Docker 的启动要求。

这些建议刻意不修改 NiceEval 已定文档，也不把研究判断写成新契约。

## 仍需证据

1. 用未改 ENTRYPOINT 的 `docker:29-dind` 派生 Node 镜像，验证 privileged 启动、`docker info` readiness、root exec 改权、非 root Agent 与 nested `docker run`。
2. 分别验证 rootful Docker、rootless Docker 与 Docker Desktop；写下 socket owner、GID、存储驱动、网络和关停行为。
3. 杀死 NiceEval runner，比较 PID 1 dead-man、独立宿主 reaper 与 provider timeout 的停止时间、残留容器和 `--keep-sandbox` 语义。
4. 比较三种日志体验：现有 tail、宿主结构化聚合、保留 daemon 原生日志；确认 CLI、Record、`docker logs` 与 Docker UI 各自需要什么。
5. 用会忽略参数的 ENTRYPOINT、会 `exec "$@"` 的官方风格 ENTRYPOINT、无 shell 镜像与会自行退出的 CMD 建兼容矩阵。
6. 向 Docker Agent 维护者确认 `eval.go` 的 dockerd 注释是否过期；在确认前不把 `--privileged` 当作 DinD 支持证据。

完成这些验证后，才能决定默认启动策略及其迁移方式。
研究样本已经足以否定“下游自定义 entrypoint 是 Docker 必需条件”，却不足以单独证明哪一种 NiceEval 默认值在所有镜像上都正确。
