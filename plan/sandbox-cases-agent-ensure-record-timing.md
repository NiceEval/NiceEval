# Sandbox Case、Agent Ensure 与开放 Timing Activity 落地 TODO

本计划负责把两份已改判的 Design 收敛成 Feature 目标契约，并把目标契约落实到
Record、Runner、Sandbox、Adapter、读取面、测试和公开文档。

涉及的 Design：

- `docs/design/multi-container-environments/`
- `docs/design/agent-install-recipe/`

本计划不删除旧 `PLAN-N.md`。Design 保留候选比较与改判理由；Feature 只描述最终目标状态。
niceeval 仍是 beta，迁移按理想形态一次完成，不为旧阶段枚举、单产物 environment 或
按 template 名跳过 Agent 检查保留公共兼容层。

## 标记

- `[S]`：串行节点。父节点和显式列出的依赖全部完成后才能开始。
- `[P]`：并行节点。依赖满足后，可与其它 `[P]` 兄弟同时执行。
- `[X]`：需要 Docker、云 Sandbox、registry、真实 Agent CLI 或外部凭据的验收。
- `[D]`：只改目标契约、测试登记或实现地图；不改源码。
- 每个叶子任务同时交付其范围内的实现、已登记类别内的测试、公开出口与文档同步。
- 多 agent 直接在 `main` 当前工作目录协作；领取节点前先检查目标文件的未提交 diff，
  不格式化、覆盖或提交别人的改动。

## 已裁决前提

执行者不得重新打开以下问题：

- Eval 仍只选择 environment profile，不选择 provider。
- 每个 sandbox case 只返回一个主 `Sandbox`；Agent、Eval、文件 API、workdir、分类账与
  diff 观察同一个执行空间。
- provider 原生能力优先，不承诺同一 profile 自动跨 provider 迁移。
- Docker Compose case 原生消费 Compose；NiceEval 不维护字段白名单解析器。
- BuildKey 负责构建产物复用；CaseKey 负责完整 attempt 环境身份与携带门。
- Agent Ensure 属于 Adapter：检查精确身份，缺失时安装，随后复检。
- 预装 Agent 是 Ensure 的检查命中优化，不是任意任务环境可运行的前提。
- Agent identity 与 sandbox case identity 正交进入指纹。
- 共享 BuildKey 构建不属于任一 attempt，不占 attempt 并发位，也不计入
  `executionMs`；它必须有 Run 级预算、时间、失败和 provenance。
- `LifecyclePhase` 不是任意扩展点。它是 Runner 拥有的 attempt 生命周期锚点，
  决定主链、收尾、deadline、错误归属和 `executionMs` 口径。
- 可扩展性由 timing activity 提供。Activity 使用稳定机器 key；未知 key 可通用读取和展示，
  但不能自行改变 verdict、deadline、资源释放或主耗时口径。
- `sandbox.build` 是第一种 Run 级 timing activity，不新增为 attempt
  `LifecyclePhase`。
- 故意断网的题面不能被 Agent 安装流程提前修复。内置 coding Agent 的默认安装路径必须能在
  题面网络之外准备锁定制品，再经主 Sandbox 文件通道送入；否则
  `broken-networking` 不能算通过验收。

## 树形 TODO

- [ ] `[S]` 完成 Sandbox Case、Agent Ensure 与开放 Timing Activity 的目标落地

  - [ ] `[S][D]` 固化 Record 的“两层时间模型”

    - [ ] 将 `LifecyclePhase` 收窄为 Runner 保留的 attempt 生命周期锚点。
      - 闭集只包含会影响 attempt 执行语义的边界。
      - `error`、attempt diagnostic、live 当前步骤仍由 Runner 绑定锚点；
        author、Adapter 与 provider 不能冒充。
      - 主链、嵌套 `agent.run`、收尾成员及 `executionMs` 排除规则继续穷尽声明。
    - [ ] 定稿开放 `ActivityKey`。
      - key 是非空、带命名空间的稳定字符串，例如
        `sandbox.build`、`agent.artifact.prepare`、`provider.image.pull`。
      - NiceEval 保留 `sandbox`、`agent`、`eval`、`workspace`、`scoring`、
        `telemetry`、`experiment`、`judge`、`record` 顶级命名空间。
      - 第三方 key 使用自己的 provider、Adapter 或 package 命名空间。
      - key 只表达“这项工作是什么”；人读文字由 `label` 表达，消费者不得解析 label
        重建语义。
    - [ ] 定稿 Run/Attempt 共用的 `TimingActivity`。

      ```typescript
      interface TimingActivity {
        id: string;
        key: string;
        label: string;
        startOffsetMs: number;
        durationMs: number;
        failed?: true;
        children?: TimingActivity[];
      }
      ```

      - `RunMeta.timings` 的 offset 相对该 Run 的单调时钟起点。
      - `PhaseTiming.children` 的 offset 相对该 attempt 的单调时钟起点。
      - 容器字段决定时钟域；activity 自己不重复保存 scope。
      - sibling 可以并发，不能通过数组顺序或 duration 求和推导包络。
      - 未知 key 原样保留并通用渲染；读取器不得拒绝整份记录。
    - [ ] 保留专用 activity 结构化字段的归属。
      - `turn` 的 session/turn/trace/usage 字段继续由 Agent 运行 activity 使用。
      - `command` 的 display/exitCode 与 `commands.json` 关联继续成立。
      - provider、hook、operation 不再依赖封闭 `TimingNodeKind` 才能增加新工作类型；
        若仍保留 `kind`，它只能是展示提示，未知值必须可读。
    - [ ] 重构错误与诊断归属。

      ```typescript
      type TimingOrigin =
        | {
            scope: "attempt";
            phase: LifecyclePhase;
            timingNodeId?: string;
          }
        | {
            scope: "run";
            timingNodeId: string;
          };
      ```

      - attempt 内致命错误保留 Runner 锚点，可进一步指向 activity。
      - attempt 开始前发生的共享构建错误引用 Run timing node，不伪造
        `sandbox.create` 或其它 attempt phase。
      - Run diagnostic 可以只引用 Run timing node。
      - timing node 的 key 由记录关联得到，不在 error/diagnostic 复制，避免漂移。
      - 没有 timing 的第三方 producer 允许只保留 attempt phase 或无 origin 的
        Run diagnostic。
    - [ ] 在 `docs/feature/record/architecture.md` 穷尽写出：
      - `RunMeta.timings`；
      - attempt `PhaseTiming` 与 activity 子树；
      - `TimingOrigin`；
      - 未知 key、未知字段与 schemaVersion 的关系；
      - Run/attempt 两个时钟域；
      - 携带、publish 与复制对 timing/origin 的忠实保留。
    - [ ] 修正当前“全仓唯一闭集”与“未知 phase 可读”混写。
      - 生命周期语义是闭集。
      - activity key 是开放集合。
      - 新增普通 activity key 不升 schemaVersion。
      - 改变已有 key 的结构化语义或时钟域属于破坏性格式变化。

    验收：

    - 文档能唯一回答未知 activity key 如何显示、是否计入 `executionMs`、能否改变 verdict。
    - 文档能唯一回答共享构建失败为何没有 attempt `LifecyclePhase`。
    - `rg` 不再命中“计时、错误、diagnostic、live 全部共用一个可扩展 phase 字符串”的旧口径。
    - `pnpm test:docs` 通过。

  - [ ] `[S][D]` 用两层时间模型重裁多容器预算与 Record 形状
    依赖：Record 两层时间模型

    - [ ] 重写多容器 `GOALS.md` 的预算要求。
      - Run 级共享准备：BuildKey 构建、共享拉取或发布受独立并发、逐项 timeout、
        全局准备上限和 Invocation abort 约束。
      - attempt 级实例物化：创建资源组、服务 ready、Agent Ensure、执行与评分共享
        attempt 并发位和 deadline。
      - 不再要求共享构建计入每个 attempt 的时间与并发预算。
    - [ ] 定稿 `sandboxBuilds` 为 provenance，而不是第二套时间树。

      ```typescript
      interface SandboxBuildRecord {
        buildKey: string;
        provider: string;
        status: "hit" | "built" | "failed" | "cancelled";
        timingNodeId: string;
        locator?: JsonValue;
        resolvedInputs: JsonValue;
        error?: RunError;
      }
      ```

      - 每个实际查询或构建的 BuildKey 一条。
      - timing 只在 `RunMeta.timings` 保存；`sandboxBuilds` 通过 id 关联。
      - 多个 attempts 通过 BuildKey/记录 id 引用同一 provenance，不复制 duration。
      - cache hit 也留下有界查询 activity；完全被携带、无需查询的 BuildKey 不制造假记录。
    - [ ] 定稿 `sandbox.build` activity。
      - 每个 BuildKey 是一个可并发 activity 实例。
      - Build 内部可挂 `provider.image.resolve`、`provider.image.pull`、
        `provider.build.execute` 等开放子 key。
      - Run 读取面按 key 通用展示；Sandbox 专用读取面再用 `sandboxBuilds`
        展示 locator、输入和依赖 attempts。
    - [ ] 定稿共享构建失败。
      - 失败的 BuildKey 只执行一次。
      - 所有依赖它且本应 fresh 执行的 attempts 得到 `errored`，origin 指向同一个
        Run timing node。
      - 不依赖该 key 的 attempts 继续执行，除非失败分类触发 eval/experiment scope
        止损。
      - carried attempts 不因查看历史结果触发构建，也不引用本 Run 不存在的 build。
    - [ ] 同步：
      - `docs/design/multi-container-environments/{GOALS,PLAN-4,DECISION,CASES}.md`；
      - `memory/env-cases-and-ensure-supersede-topology-middleware.md`；
      - 上一轮 review ledger 只作历史链接，不回改旧裁决正文。

    验收：

    - GOALS、PLAN-4、DECISION 对 R10 的描述完全一致。
    - 一次十分钟 BuildKey 构建不会出现在十条 attempt 的 `executionMs` 中。
    - Run 总时间、构建排队、构建执行和每条 attempt 时间均可从 Record 指出来源。
    - 构建失败的 attempts 不携带虚假的 `sandbox.create` phase。

  - [ ] `[S][D]` 补齐故意断网环境的 Agent Ensure 契约
    依赖：Record 两层时间模型

    - [ ] 把 provisioner 拆成“锁定身份、题面外准备、主 Sandbox 内 Ensure”三项义务，
      不建立跨 provider 安装步骤 DSL。
    - [ ] 定稿内置 coding Agent 的锁定制品准备。
      - 以 Agent identity + target platform/libc 为 key。
      - 在 Run 级通过宿主网络、provider control plane 或随包制品取得一次。
      - 校验 digest 后进入本地/远端共享 cache。
      - 时间记录为开放 activity `agent.artifact.prepare`。
      - 解析后的制品 digest 与平台进入 configHash 和 `run.json`。
    - [ ] 定稿 Sandbox 内安装运输。
      - 通过主 Sandbox 的文件 API 上传已准备 payload。
      - 安装不得要求修复题面 DNS、代理、`extra_hosts` 或 egress。
      - payload 要么包含 Agent 所需运行时，要么 provisioner 在规划期声明并检查稳定前置条件。
      - 安装只修改主 Sandbox；外层 DinD VM 与 sidecars 不安装 Agent。
    - [ ] 保留在线与 `verifyOnly` 变体，但要求显式。
      - `staged`：默认内置路径，题面网络不可用也能安装。
      - `sandbox-network`：自定义 provisioner 显式声明，网络/包管理器是支持面。
      - `verifyOnly`：只接受预装且检查命中的环境。
      - 不允许失败后在三种模式之间静默猜测或降级。
    - [ ] 重写 `broken-networking` 真题调用与验收。
      - 默认 `codexAgent()` 必须使用 staged payload。
      - provider 不改坏 DNS、不恢复被替换的 curl/apt。
      - Agent 安装检查通过后，题面网络仍保持故障。
      - Agent 完成任务后 verifier 才观察网络是否由 Agent 修好。
    - [ ] 同步：
      - `docs/design/agent-install-recipe/{GOALS,PLAN-4,DECISION}.md`；
      - `docs/design/multi-container-environments/CASES.md`；
      - memory 裁决条目。

    验收：

    - `broken-networking` 不需要 `<题目 × Agent>` 预制镜像即可进入 Agent。
    - 删除 staged payload 路径后，断网题验收必须失败在 `agent.setup`，证明用例有区分力。
    - Agent 安装前后 CaseKey 不变；Agent artifact identity 单独改变 attempt 指纹。
    - 题面 DNS/hosts 在 Agent 进场前逐字保持。

  - [ ] `[S][D]` 将定稿 Design 合并到 Feature
    依赖：多容器预算重裁 + 断网 Ensure 契约

    - [ ] `[P][D]` Record Feature 合并
      - 更新 `docs/feature/record/{README,architecture,library}.md`。
      - 将开放 timing activity、Run timings、origin、sandboxBuilds 关联写成目标状态。
      - 更新发布/复制/读取规则；未知 key 通用展示，不要求 reader 认识业务含义。
    - [ ] `[P][D]` Sandbox Feature 合并
      - 更新 `docs/feature/sandbox/{README,architecture,library,cli}.md`。
      - 新增 sandbox case 的目标契约页；内容至少覆盖：
        profile/source 双入口、materializer、主 Sandbox、可选能力句柄、
        BuildKey/CaseKey、资源组、错误、清理、留存、能力缺失。
      - 为 Docker、E2B、Vercel、Local 分别建立 provider 能力页；
        每篇明确支持的 case、materializer、keep、services 与限制。
      - Docker 页写 Compose 原生消费与安全黑名单；云 provider 未经真机验收不声明 Compose。
    - [ ] `[P][D]` Adapter Feature 合并
      - 更新 `docs/feature/adapters/{README,architecture,library}.md` 及
        `architecture/agent-contract.md`、`library/sandbox-agent.md`。
      - 定稿 `AgentProvisioner` 的身份、准备、check/install/recheck、安装事实、
        错误与复用语义。
      - 每个内置 Sandbox Agent 的 SDK 页说明实际 check 与 staged payload 支持面。
    - [ ] `[P][D]` Eval / Experiments Feature 合并
      - 更新 folder eval 发现、`composeSandbox` source、profile 默认 id、
        hidden verifier/private 路径和 source kind 能力协商。
      - 更新 Experiment 的 `environments` / `materializers` 双入口、优先级、
        build 并发与全 skipped 报错。
      - 将 `sandbox.build` 的 live/JSON/落盘读取语义写入 CLI 契约。
    - [ ] `[S][D]` 跨 Feature 收口
      依赖：四条 Feature 文档并行线
      - Feature 正文只写最终状态，不写“旧方案、目前未实现、本轮改了什么”。
      - Design `DECISION.md` 链到 Feature 单一契约入口，不复制完整类型。
      - Design 保留“为什么选 PLAN-4、为什么否决其它方案”。
      - 更新 `docs/README.md`、各 Feature README 索引、`docs/concepts.md`、
        `docs/source-map.md` 和需要的新禁词/术语。
      - 更新 `memory/INDEX.md`；普通实现过程不新增 memory。

    验收：

    - 一个只读 Feature 的实现者可以完成 Record、Sandbox case 与 Ensure，
      不必从 Design 猜目标行为。
    - 一个只读 Design 的 reviewer 可以知道选型理由，并被链接送到 Feature 契约。
    - 同一事实只有一个 Feature 正文完整定义，其它页只链接。
    - `pnpm test:docs` 通过。

  - [ ] `[S][D]` 先登记测试覆盖与实现地图
    依赖：Feature 合并

    - [ ] 在 `docs/engineering/testing/unit/record.md` 登记：
      - 开放 key 往返与未知 key 读取；
      - Run/attempt 双时钟域；
      - TimingOrigin 的 attempt/run 两支；
      - publish/carry 对 timing 引用的忠实保留；
      - sandboxBuilds 与 timingNodeId 引用完整性。
    - [ ] 在 `docs/engineering/testing/unit/sandbox.md` 登记：
      - sandbox case 五类；
      - profile/source 双入口与优先级；
      - BuildKey single-flight、失败扇出和预算；
      - Compose 主空间、服务 ready、证据、整组清理与泄题门。
    - [ ] 新增 `docs/engineering/testing/unit/adapters.md` 并更新 registry：
      - Ensure 检查命中、staged 安装、复检失败；
      - Agent identity / artifact identity；
      - 断网题不改网络；
      - Sandbox 复用命中与 environment 隔离。
    - [ ] 在 `docs/engineering/testing/unit/experiments-runner.md` 登记：
      - 共享 Run activity 不占 attempt 位；
      - build failure 的 Run origin；
      - 全 skipped 启动错误；
      - live feedback 的未知 activity 通用投影。
    - [ ] 更新 `docs/source-map.md`，先列目标源码落点，不写实现进度句。

    验收：

    - 后续每条新测试都能指向一个已声明覆盖类别。
    - 删除任一类别可明确说出会放走哪类错误。
    - registry 守护与 `pnpm test:docs` 通过。

  - [ ] `[S]` 实现 Feature 目标契约
    依赖：测试覆盖与实现地图登记

    - [ ] `[P]` Record 与通用 timing activity
      - 落点：
        `src/runner/types.ts`、`src/runner/timing.ts`、
        `src/record/types.ts`、`src/record/{writer,open,copy,publish}.ts`。
      - 实现 `TimingActivity`、Run timings、双时钟 recorder、TimingOrigin。
      - 将现有 attempt children 迁到开放 key；保留必要 turn/command 结构化字段。
      - writer 原子封口 Run timings；reader、publish、copy 忠实往返。
      - 第三方 writer 可以写未知 key；官方 reader 不需要 registry 才能显示。
    - [ ] `[P]` Sandbox source、case 与身份内核
      - 落点：
        `src/sandbox/types.ts`、`src/sandbox/resolve.ts`、`src/sandbox/index.ts`，
        新增 case/materializer/identity 模块。
      - 实现 profile/source 双入口、显式映射优先、source kind 协商。
      - 实现 SandboxCase → 主 Sandbox + 能力句柄 + 资源组。
      - 实现 BuildKey/CaseKey、浮动 tag digest 解析、凭据 revision 规则。
      - 自定义 case 强制纯数据 identity；缺稳定身份时禁止携带。
    - [ ] `[P]` Eval folder 与隐藏输入安全
      - 落点：
        `src/runner/discover.ts`、`src/runner/eval-source.ts` 及 loaders。
      - 实现 `evals/foo/eval.ts`，与 `foo.eval.ts` 重名时报错。
      - 实现 folder-local sandbox source 和默认 profile id。
      - verifier/private 与所有 build context、bind mounts 做交叉检查。
      - filtered context 规则进入 BuildKey。
    - [ ] `[P]` AgentProvisioner 与 staged payload
      - 落点：
        `src/agents/types.ts`、`src/agents/shared.ts`、内置 coding Agent、
        `src/runner/run.ts` 与 `src/runner/attempt.ts`。
      - 实现 identity、prepare、check/install/recheck 与安装事实。
      - Run 级 payload single-flight/cache 记录 `agent.artifact.prepare`。
      - 主 Sandbox 内通过文件 API 安装；不借题面网络。
      - 官方预装、自建预装、缺失、错版本、verifyOnly 走同一状态机。
    - [ ] `[S]` Run 级构建协调器
      依赖：Record timing + Sandbox case 内核
      - 携带规划后，只为仍需 fresh 执行的 BuildKey 工作。
      - 实现独立并发、逐 key timeout、全局准备上限、abort/cancel。
      - provider cache/registry 查询与 single-flight。
      - 写 `sandbox.build` timings 与 `sandboxBuilds` provenance。
      - 失败按依赖集合扇出，共用 Run timing origin。
    - [ ] `[S]` Docker Compose case
      依赖：Sandbox case 内核 + Run 构建协调器 + Eval folder 安全
      - 原生 Compose build/up/down，生成受管 overlay。
      - mainService 包装为唯一主 Sandbox。
      - Compose 依赖、healthcheck、一次性 init、DNS、extra_hosts、
        named volume、只读投影原样生效。
      - 安全黑名单拒绝 Docker socket、脱管网络、覆盖 workdir 等破坏核心不变量的字段。
      - 服务状态/log、异常退出、部分启动、中断和超时走整组 finalizer。
    - [ ] `[S]` 单 Sandbox 与自定义 case 迁移
      依赖：Sandbox case 内核
      - Docker image、E2B template、Vercel snapshot、Local 现有路径包装成单 case。
      - 现有行为是新模型严格子集。
      - 自定义 case 的 identity、services、detached cleanup 与 group keep 守卫落地。
    - [ ] `[S]` CLI、feedback、Record 读取与报告投影
      依赖：Record timing + Run 构建协调器
      - Run active 区显示共享 build activity，不占 attempt active slot。
      - 非 TTY 与 `--json` 给有界 build 起止/失败事件。
      - `niceeval show --timing` 能读取 Run activity 和 attempt lifecycle 两棵树。
      - 未知 activity key 使用通用 label，不需要 switch 穷尽。
      - sandboxBuild 专用卡从 provenance 读取，不解析 timing label。
      - `phaseLabel()` 只服务保留的 LifecyclePhase；activity label 不塞进该 switch。

    验收：

    - 五条并行线只在声明的源码边界内工作；共享类型先合流再开始依赖节点。
    - 新公共形状不保留旧枚举扩展兼容层。
    - `pnpm run typecheck` 和受影响单元测试通过。

  - [ ] `[S]` 联调两份 PLAN-4
    依赖：Feature 目标契约实现

    - [ ] 用同一组 folder eval 跑 Docker Compose case。
    - [ ] 证明主 Sandbox 返回后，Agent Ensure 只修改 mainService。
    - [ ] 证明同一任务 BuildKey 被两个不同 Agent experiment 共用。
    - [ ] 改 Agent 版本：
      - 不重建任务 BuildKey；
      - 改 Agent artifact activity 与 attempt fingerprint；
      - 不携带旧结果。
    - [ ] 改 sidecar bind mount：
      - 不重建无关 client image；
      - 改 CaseKey；
      - 不携带旧结果。
    - [ ] 改 verifier：
      - 不改 BuildKey/CaseKey；
      - 只作废 eval 判据指纹。
    - [ ] 构建失败、ready 失败、Agent Ensure 失败、断言失败分别落到：
      - Run build origin；
      - attempt 环境 `errored`；
      - `agent.setup` `errored`；
      - `failed`。

    验收：

    - 四种失败在 Record、CLI、报告中不混淆。
    - Run build duration 只出现一次，attempt `executionMs` 不含共享构建。
    - `sandboxBuilds`、Run timing、CaseKey、Agent identity 和 attempt locator 可互相追溯。

  - [ ] `[P][X]` 跑真实环境验收
    依赖：联调两份 PLAN-4

    - [ ] `[P][X]` Docker 四道 Terminal-Bench 真题
      - `broken-networking`
      - `debug-long-program`
      - `simple-sheets-put`
      - `sql-injection-attack`
    - [ ] `[P][X]` 内置 Agent staged payload
      - Codex 至少覆盖正确预装、无预装、错版本、断网安装、非 root 安装。
      - 再选一个不同安装形态的 coding Agent，防止抽象只对 Codex 成立。
    - [ ] `[P][X]` 云 provider 单 Dockerfile 按需构建
      - 同 BuildKey 第二次命中 provider locator。
      - 改 context 自动重建。
    - [ ] `[P][X]` 云端 Compose 能力探针
      - 只选择一家真实 provider 验证 DinD、Pod 或原生组网。
      - 主文件 API、网络视角、ready、整组回收任一不满足就不声明 Compose 能力。
    - [ ] `[P][X]` group keep
      - Docker 资源组 suspend/resume 后重过 ready。
      - 不支持者在创建前报错，不只暂停 primary。

    验收：

    - 外部基础设施故障按 E2E 协议退出 `75`，不能当产品通过。
    - 每项验收保存原始 Run、CLI 输出和 provider 资源清理证据。
    - 真机行为与 capability 文档一致；不一致时收窄能力，不改题目语义。

  - [ ] `[S]` 收口公开文档、示例与死路径
    依赖：真实环境验收

    - [ ] 更新 `docs/source-map.md` 为真实源码落点，删除已完成差异。
    - [ ] 同步 docs-site：
      - folder eval；
      - Docker Compose 环境；
      - provider 能力选择；
      - 预装命中与 staged Ensure；
      - 构建时间和错误怎么看。
    - [ ] 增加可运行示例：
      - 单 Sandbox profile；
      - folder-local Dockerfile；
      - Compose main + sidecar；
      - 自定义 provisioner。
    - [ ] 更新生成参考/TSDoc/package exports。
    - [ ] 删除只服务旧模型的死代码、旧 phase switch、旧环境表拼接和按 template 名短路。
    - [ ] Design 的落地路线不改写成实现状态；完成事实只进 commit 和 source-map 差异删除。

    验收：

    - `rg` 对旧公共名的命中只允许在 Design、memory 或明确历史引用里。
    - `pnpm docs:reference` 后没有生成区块漂移。
    - `pnpm test:docs`、`pnpm test:docs-site` 通过。
    - 示例按 `examples/README.md` 的命令通过。

## 并行与串行关系

```text
Record 两层时间模型
├──> 多容器预算 + sandbox.build ─┐
└──> 断网 Ensure + artifact.prepare ─┴──> Design 交叉复审
                                              │
                                              v
                    Feature 合并（四路并行）
                    ├── Record
                    ├── Sandbox
                    ├── Adapters
                    └── Eval / Experiments
                                              │
                                              v
                              跨 Feature 收口（串行）
                                              │
                                              v
                              测试登记 + source-map
                                              │
                                              v
                 实现（共享类型合流后四路并行）
                 ├── Record timing
                 ├── Sandbox case / identity
                 ├── Eval folder / leak gate
                 └── AgentProvisioner / staged payload
                         │
                         ├──> 构建协调器 ──> Docker Compose
                         └──> 单 Sandbox / custom case
                                              │
                                              v
                              CLI / 读取面 ──> 联调
                                              │
                                              v
                         真实验收（Docker / Agent / 云 / keep 并行）
                                              │
                                              v
                                  文档与死路径收口
```

并行执行的文件边界：

- Record 线拥有 `src/record/**`、`src/runner/timing.ts` 和 timing 类型；
- Sandbox 线拥有 `src/sandbox/**` 与 case/materializer/build 模块；
- Eval folder 线拥有 discovery、eval-source 与 loader；
- Agent 线拥有 `src/agents/**` 与 provisioner 模块；
- `src/runner/run.ts`、`src/runner/attempt.ts`、`src/types.ts`、`src/index.ts`、
  `package.json` 属于合流文件，叶子 agent 不并行直接改；由对应串行节点统一接线。

Feature 文档四路可以并行，但每路只写自己的 Feature。跨 Feature 名词、类型和链接由
“跨 Feature 收口”节点统一处理，避免四个 agent 同时修改 `docs/README.md`、
`docs/concepts.md` 与 `docs/source-map.md`。

## 验收

### 每个叶子任务

- 动测试前先在对应 Feature 测试文档登记覆盖类别；没有声明的类别不写测试。
- 先跑受影响测试文件，再跑所属测试命令。
- 修改公共 API 时同步 TSDoc、package exports、生成参考和消费 fixture。
- 修改 Record 形状时同时验证 writer → disk → reader → publish 的完整往返。
- 修改 provider 生命周期时同时验证成功、部分创建、失败、中断、超时和 keep/stop。
- 提交前检查 `git status`、未暂存 diff 与暂存 diff；只提交本节点路径。

### 契约验收

| 契约面 | 必须证明 |
|---|---|
| Timing | 生命周期锚点仍封闭；未知 activity key 可读；Run/attempt 时钟不混用 |
| Build | 同 BuildKey 一次工作、多 attempt 引用；共享时间不复制进 `executionMs` |
| Error | build / create / ready / Ensure / assertion 五类归属互不冒充 |
| Identity | BuildKey、CaseKey、Agent identity、artifact digest 各自只响应自己的输入 |
| Sandbox | Agent、Eval、文件 API、workdir、diff 永远锚定同一个 main Sandbox |
| Compose | 真题字段原样生效；黑名单只保护 NiceEval 核心不变量 |
| Ensure | 预装与后装同一检查；断网题不修网络也能安装 Agent |
| Cleanup | 单实例与资源组在成功、失败、中断、超时下都无孤儿 |
| Docs | Feature 定义目标状态；Design 只保留选型理由并链接 Feature |

### 自动验证

```sh
pnpm run typecheck
pnpm test
pnpm test:docs
pnpm test:docs-site
pnpm run prepare
pnpm e2e --repo cli
pnpm e2e --repo report
pnpm e2e --group sandbox
```

若新增 Terminal-Bench 独立功能仓库，再单独运行：

```sh
pnpm e2e --repo sandbox-cases
```

### 完成定义

- `LifecyclePhase` 不再承担开放扩展职责；读取器对未知 activity key 有稳定回退。
- `RunMeta.timings` 与 attempt `phases` 两个时钟域均能从公开 Record API 读取。
- `sandbox.build`、`agent.artifact.prepare` 至少各有一条真实 Run 记录。
- 四道 Terminal-Bench 真题在 Docker case 中保持原环境语义并完成验收。
- `broken-networking` 使用默认内置 Agent 时不依赖题面网络完成 Ensure。
- 同一任务环境可以被两个 Agent 使用，不发布 `<题目 × Agent>` 制品矩阵。
- Design 的最终结论全部有 Feature 契约落点；Feature 不要求读者回 Design 补行为。
- source-map 不再列本计划范围内的已知实现差异。
- 全部自动验证与声明的真实环境验收通过。
