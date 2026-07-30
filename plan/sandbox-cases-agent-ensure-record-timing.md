# Sandbox Case、Agent Ensure 与开放 Timing Activity 落地 TODO

本计划把已定稿的 Feature 契约落实到测试登记、源码实现、联调、真机验收与公开文档。

**契约输入(已定稿,单源在 Feature,执行者不读 Design 推行为):**

- `docs/feature/record/architecture.md` —— 两层时间模型:`LifecyclePhase` 锚点闭集、
  开放 `ActivityKey` 与 `TimingActivity`、`TimingOrigin`、`RunMeta.timings`、`sandboxBuilds`,
  schemaVersion 13。
- `docs/feature/sandbox/case.md` —— sandbox case:双入口、五类 case、BuildKey / CaseKey、
  Run 级构建协调、Docker Compose、泄题门、资源组与能力矩阵。
- `docs/feature/adapters/architecture/agent-ensure.md` —— AgentProvisioner 三义务、
  三种安装模式、staged payload、断网题义务、身份正交。
- `docs/feature/eval/README.md`(文件夹入口)、`docs/feature/experiments/architecture.md`
  (Run 级共享准备)、`docs/feature/experiments/cache.md`(指纹输入)。

Design 两目录(`docs/design/multi-container-environments/`、`docs/design/agent-install-recipe/`)
只保留选型理由与改判依据,`DECISION.md` 已链接 Feature 契约入口;后续节点不再往 Design 写契约正文。
niceeval 仍是 beta,迁移按理想形态一次完成,不为旧阶段枚举、单产物 environment 或按
template 名跳过 Agent 检查保留公共兼容层。

## 标记

- `[S]`:串行节点。父节点和显式列出的依赖全部完成后才能开始。
- `[P]`:并行节点。依赖满足后,可与其它 `[P]` 兄弟同时执行。
- `[X]`:需要 Docker、云 Sandbox、registry、真实 Agent CLI 或外部凭据的验收。
- `[D]`:只改测试登记或实现地图;不改源码。
- 每个叶子任务同时交付其范围内的实现、已登记类别内的测试、公开出口与文档同步。
- 多 agent 直接在 `main` 当前工作目录协作;领取节点前先检查目标文件的未提交 diff,
  不格式化、覆盖或提交别人的改动。

## 已裁决前提

执行者不得重新打开以下问题(正文出处在上列 Feature 契约):

- Eval 仍只选择 environment profile 或 folder-local source,不选择 provider。
- 每个 sandbox case 只返回一个主 `Sandbox`;Agent、Eval、文件 API、workdir、分类账与
  diff 观察同一个执行空间。
- provider 原生能力优先,不承诺同一 profile 自动跨 provider 迁移。
- Docker Compose case 原生消费 Compose;NiceEval 不维护字段白名单解析器。
- BuildKey 负责构建产物复用;CaseKey 负责完整 attempt 环境身份与携带门。
- Agent Ensure 属于 Adapter:检查精确身份,缺失时安装,随后复检;预装是检查命中优化。
- Ensure 的公开形态是独立 `AgentProvisioner` 值对象(identity/check/install 原子替换,
  经 sandbox agent 工厂参数拔插),不在 `SandboxAgentDef` 上散布方法;Runner 只额外消费
  `identity` 与 `prepare`,`check` 返回结构化检查事实(`AgentCheckResult`),不返回 boolean。
- Agent identity 与 sandbox case identity 正交进入指纹。
- 共享 BuildKey 构建不属于任一 attempt,不占 attempt 并发位,不计入 `executionMs`;
  它有 Run 级预算、时间、失败和 provenance。
- `LifecyclePhase` 是 Runner 拥有的锚点闭集;可扩展性由开放 activity key 提供,
  未知 key 可通用读取但不能改变 verdict、deadline 或主耗时口径。
- 故意断网的题面不能被 Agent 安装流程提前修复;默认安装路径走 staged payload。

## 树形 TODO

- [ ] `[S]` 完成 Sandbox Case、Agent Ensure 与开放 Timing Activity 的目标落地

  - [ ] `[S][D]` 先登记测试覆盖与实现地图

    - [ ] 在 `docs/engineering/testing/unit/record.md` 登记:
      - 开放 key 往返与未知 key 读取;
      - Run/attempt 双时钟域;
      - TimingOrigin 的 attempt/run 两支;
      - publish/carry 对 timing 引用的忠实保留;
      - sandboxBuilds 与 timingNodeId 引用完整性。
    - [ ] 在 `docs/engineering/testing/unit/sandbox.md` 登记:
      - sandbox case 五类;
      - profile/source 双入口与优先级;
      - BuildKey single-flight、失败扇出和预算;
      - Compose 主空间、服务 ready、证据、整组清理与泄题门。
    - [ ] 新增 `docs/engineering/testing/unit/adapters.md` 并更新 registry:
      - Ensure 检查命中、staged 安装、复检失败;
      - Agent identity / artifact identity;
      - 断网题不改网络;
      - Sandbox 复用命中与 environment 隔离。
    - [ ] 在 `docs/engineering/testing/unit/experiments-runner.md` 登记:
      - 共享 Run activity 不占 attempt 位;
      - build failure 的 Run origin;
      - 全 skipped 启动错误;
      - live feedback 的未知 activity 通用投影。
    - [ ] 核对 `docs/source-map.md` 已列的目标源码落点,缺的补上,不写实现进度句。

    验收:

    - 后续每条新测试都能指向一个已声明覆盖类别。
    - 删除任一类别可明确说出会放走哪类错误。
    - registry 守护与 `pnpm test:docs` 通过。

  - [ ] `[S]` 实现 Feature 目标契约
    依赖:测试覆盖与实现地图登记

    - [ ] `[P]` Record 与通用 timing activity
      - 落点:
        `src/runner/types.ts`、`src/runner/timing.ts`、
        `src/record/types.ts`、`src/record/{writer,open,copy,publish}.ts`。
      - 实现 `TimingActivity`、Run timings、双时钟 recorder、`TimingOrigin`,
        schemaVersion 升 13。
      - 将现有 attempt children 迁到开放 key;保留 `agent.turn` / `sandbox.command`
        的结构化字段。
      - writer 原子封口 Run timings;reader、publish、copy 忠实往返。
      - 第三方 writer 可以写未知 key;官方 reader 不需要 registry 才能显示。
    - [ ] `[P]` Sandbox source、case 与身份内核
      - 落点:
        `src/sandbox/types.ts`、`src/sandbox/resolve.ts`、`src/sandbox/index.ts`,
        新增 `src/sandbox/case.ts` / `src/sandbox/identity.ts`。
      - 实现 profile/source 双入口、显式映射优先、source kind 协商与两类缺失判定。
      - 实现 SandboxCase → 主 Sandbox + 能力句柄 + 资源组。
      - 实现 BuildKey/CaseKey、浮动 tag digest 解析、凭据 revision 规则。
      - 自定义 case 强制纯数据 identity;缺稳定身份时禁止携带。
    - [ ] `[P]` Eval folder 与隐藏输入安全
      - 落点:
        `src/runner/discover.ts`、`src/runner/eval-source.ts` 及 loaders。
      - 实现 `evals/foo/eval.ts`,与 `foo.eval.ts` 重名时报错。
      - 实现 folder-local sandbox source 和默认 profile id。
      - verifier/private 与所有 build context、bind mounts 做交叉检查。
      - filtered context 规则进入 BuildKey。
    - [ ] `[P]` AgentProvisioner 与 staged payload
      - 落点:
        `src/agents/types.ts`、`src/agents/provisioner.ts`、`src/agents/shared.ts`、
        内置 coding Agent、`src/runner/run.ts` 与 `src/runner/attempt.ts`。
      - 实现 identity、prepare、check/install/recheck 与安装事实。
      - Run 级 payload single-flight/cache 记录 `agent.artifact.prepare`。
      - 主 Sandbox 内通过文件 API 安装;不借题面网络。
      - 官方预装、自建预装、缺失、错版本、verifyOnly 走同一状态机。
    - [ ] `[S]` Run 级构建协调器
      依赖:Record timing + Sandbox case 内核
      - 落点:`src/sandbox/build-coordinator.ts`,接线在 `src/runner/run.ts`。
      - 携带规划后,只为仍需 fresh 执行的 BuildKey 工作。
      - 实现独立并发、逐 key timeout、全局准备上限、abort/cancel。
      - provider cache/registry 查询与 single-flight。
      - 写 `sandbox.build` timings 与 `sandboxBuilds` provenance。
      - 失败按依赖集合扇出,共用 Run timing origin。
    - [ ] `[S]` Docker Compose case
      依赖:Sandbox case 内核 + Run 构建协调器 + Eval folder 安全
      - 落点:`src/sandbox/compose.ts`。
      - 原生 Compose build/up/down,生成受管 overlay。
      - mainService 包装为唯一主 Sandbox。
      - Compose 依赖、healthcheck、一次性 init、DNS、extra_hosts、
        named volume、只读投影原样生效。
      - 安全黑名单拒绝 Docker socket、脱管网络、覆盖 workdir 等破坏核心不变量的字段。
      - 服务状态/log、异常退出、部分启动、中断和超时走整组 finalizer。
    - [ ] `[S]` 单 Sandbox 与自定义 case 迁移
      依赖:Sandbox case 内核
      - Docker image、E2B template、Vercel snapshot、Local 现有路径包装成单 case。
      - 现有行为是新模型严格子集。
      - 自定义 case 的 identity、services、detached cleanup 与 group keep 守卫落地。
    - [ ] `[S]` CLI、feedback、Record 读取与报告投影
      依赖:Record timing + Run 构建协调器
      - Run active 区显示共享 build activity,不占 attempt active slot。
      - 非 TTY 与 `--json` 给有界 build 起止/失败事件。
      - `niceeval show --timing` 能读取 Run activity 和 attempt lifecycle 两棵树。
      - 未知 activity key 使用通用 label,不需要 switch 穷尽。
      - sandboxBuild 专用卡从 provenance 读取,不解析 timing label。
      - 锚点本地化标签只覆盖保留的 LifecyclePhase;activity label 不进该表。

    验收:

    - 五条并行线只在声明的源码边界内工作;共享类型先合流再开始依赖节点。
    - 新公共形状不保留旧枚举扩展兼容层。
    - `pnpm run typecheck` 和受影响单元测试通过。

  - [ ] `[S]` 联调
    依赖:Feature 目标契约实现

    - [ ] 用同一组 folder eval 跑 Docker Compose case。
    - [ ] 证明主 Sandbox 返回后,Agent Ensure 只修改 mainService。
    - [ ] 证明同一任务 BuildKey 被两个不同 Agent experiment 共用。
    - [ ] 改 Agent 版本:
      - 不重建任务 BuildKey;
      - 改 Agent artifact activity 与 attempt fingerprint;
      - 不携带旧结果。
    - [ ] 改 sidecar bind mount:
      - 不重建无关 client image;
      - 改 CaseKey;
      - 不携带旧结果。
    - [ ] 改 verifier:
      - 不改 BuildKey/CaseKey;
      - 只作废 eval 判据指纹。
    - [ ] 构建失败、ready 失败、Agent Ensure 失败、断言失败分别落到:
      - Run build origin;
      - attempt 环境 `errored`;
      - `agent.setup` `errored`;
      - `failed`。

    验收:

    - 四种失败在 Record、CLI、报告中不混淆。
    - Run build duration 只出现一次,attempt `executionMs` 不含共享构建。
    - `sandboxBuilds`、Run timing、CaseKey、Agent identity 和 attempt locator 可互相追溯。

  - [ ] `[P][X]` 跑真实环境验收
    依赖:联调

    - [ ] `[P][X]` Docker 四道 Terminal-Bench 真题
      - `broken-networking`
      - `debug-long-program`
      - `simple-sheets-put`
      - `sql-injection-attack`
    - [ ] `[P][X]` 内置 Agent staged payload
      - Codex 至少覆盖正确预装、无预装、错版本、断网安装、非 root 安装。
      - 再选一个不同安装形态的 coding Agent,防止抽象只对 Codex 成立。
    - [ ] `[P][X]` 云 provider 单 Dockerfile 按需构建
      - 同 BuildKey 第二次命中 provider locator。
      - 改 context 自动重建。
    - [ ] `[P][X]` 云端 Compose 能力探针
      - 只选择一家真实 provider 验证 DinD、Pod 或原生组网。
      - 主文件 API、网络视角、ready、整组回收任一不满足就不声明 Compose 能力,
        对应能力矩阵行保持「不声明」。
    - [ ] `[P][X]` group keep
      - Docker 资源组 suspend/resume 后重过 ready。
      - 不支持者在创建前报错,不只暂停 primary。

    验收:

    - 外部基础设施故障按 E2E 协议退出 `75`,不能当产品通过。
    - 每项验收保存原始 Run、CLI 输出和 provider 资源清理证据。
    - 真机行为与 `docs/feature/sandbox/case.md` 能力矩阵一致;不一致时收窄能力,
      不改题目语义。

  - [ ] `[S]` 收口公开文档、示例与死路径
    依赖:真实环境验收

    - [ ] 更新 `docs/source-map.md` 为真实源码落点,删除已完成差异。
    - [ ] 同步 docs-site:
      - folder eval;
      - Docker Compose 环境;
      - provider 能力选择;
      - 预装命中与 staged Ensure;
      - 构建时间和错误怎么看。
    - [ ] 增加可运行示例:
      - 单 Sandbox profile;
      - folder-local Dockerfile;
      - Compose main + sidecar;
      - 自定义 provisioner。
    - [ ] 更新生成参考/TSDoc/package exports。
    - [ ] 删除只服务旧模型的死代码、旧 phase switch、旧环境表拼接和按 template 名短路。
    - [ ] 完成事实只进 commit 和 source-map 差异删除,不回写任何文档正文。

    验收:

    - `rg` 对旧公共名(`TimingNode`、`TimingNodeKind` 等)的命中只允许在 Design、
      memory 或明确历史引用里。
    - `pnpm docs:reference` 后没有生成区块漂移。
    - `pnpm test:docs`、`pnpm test:docs-site` 通过。
    - 示例按 `examples/README.md` 的命令通过。

## 并行与串行关系

```text
测试登记 + source-map 核对
              │
              v
实现(共享类型合流后四路并行)
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
真实验收(Docker / Agent / 云 / keep 并行)
              │
              v
文档与死路径收口
```

并行执行的文件边界:

- Record 线拥有 `src/record/**`、`src/runner/timing.ts` 和 timing 类型;
- Sandbox 线拥有 `src/sandbox/**` 与 case/materializer/build 模块;
- Eval folder 线拥有 discovery、eval-source 与 loader;
- Agent 线拥有 `src/agents/**` 与 provisioner 模块;
- `src/runner/run.ts`、`src/runner/attempt.ts`、`src/types.ts`、`src/index.ts`、
  `package.json` 属于合流文件,叶子 agent 不并行直接改;由对应串行节点统一接线。

## 验收

### 每个叶子任务

- 动测试前先在对应 Feature 测试文档登记覆盖类别;没有声明的类别不写测试。
- 先跑受影响测试文件,再跑所属测试命令。
- 修改公共 API 时同步 TSDoc、package exports、生成参考和消费 fixture。
- 修改 Record 形状时同时验证 writer → disk → reader → publish 的完整往返。
- 修改 provider 生命周期时同时验证成功、部分创建、失败、中断、超时和 keep/stop。
- 提交前检查 `git status`、未暂存 diff 与暂存 diff;只提交本节点路径。

### 契约验收

| 契约面 | 必须证明 |
|---|---|
| Timing | 生命周期锚点仍封闭;未知 activity key 可读;Run/attempt 时钟不混用 |
| Build | 同 BuildKey 一次工作、多 attempt 引用;共享时间不复制进 `executionMs` |
| Error | build / create / ready / Ensure / assertion 五类归属互不冒充 |
| Identity | BuildKey、CaseKey、Agent identity、artifact digest 各自只响应自己的输入 |
| Sandbox | Agent、Eval、文件 API、workdir、diff 永远锚定同一个 main Sandbox |
| Compose | 真题字段原样生效;黑名单只保护 NiceEval 核心不变量 |
| Ensure | 预装与后装同一检查;断网题不修网络也能安装 Agent |
| Cleanup | 单实例与资源组在成功、失败、中断、超时下都无孤儿 |
| Docs | Feature 定义目标状态;Design 只保留选型理由并链接 Feature |

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

若新增 Terminal-Bench 独立功能仓库,再单独运行:

```sh
pnpm e2e --repo sandbox-cases
```

### 完成定义

- `LifecyclePhase` 不再承担开放扩展职责;读取器对未知 activity key 有稳定回退。
- `RunMeta.timings` 与 attempt `phases` 两个时钟域均能从公开 Record API 读取。
- `sandbox.build`、`agent.artifact.prepare` 至少各有一条真实 Run 记录。
- 四道 Terminal-Bench 真题在 Docker case 中保持原环境语义并完成验收。
- `broken-networking` 使用默认内置 Agent 时不依赖题面网络完成 Ensure。
- 同一任务环境可以被两个 Agent 使用,不发布 `<题目 × Agent>` 制品矩阵。
- source-map 不再列本计划范围内的已知实现差异。
- 全部自动验证与声明的真实环境验收通过。
