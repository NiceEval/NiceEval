# PLAN-4 —— Ensure 协议:先检查,缺失时安装(推荐)

**相关文档**:[README](../README.md) · [GOALS](../GOALS.md) ·
[LIMITS](../LIMITS.md) · [PLAN-1](../PLAN-1/README.md) · [PLAN-2](../PLAN-2/README.md) ·
[PLAN-3](../PLAN-3/README.md) ·
[多容器真题落地样例](../../multi-container-environments/PLAN-4/use-case/README.md) ·
[DECISION](../DECISION.md)

---

## 实现方案 4(Ensure 协议,推荐)

### 简述

把「Sandbox 里应当有哪个 Agent」与「Agent 是否已经烘进 Sandbox」
拆开。Adapter 在每次 `setup` 中执行同一条 Ensure 协议:
先检查 Agent 的可执行文件、精确版本与必要运行条件;检查
通过就直接使用,检查不通过才执行锁定版本的安装,随后再检查
一次。官方 template、自建 template、任务镜像与运行时空白
Sandbox 都走这条协议,差别只是第一次检查是否命中。

Sandbox 契约只要求 Ensure 最终检查通过;预制 Agent 是零安装
快速路径。稳定而沉重的任务依赖可以留在任务自己的起点 image / template 里,
Agent 在沙箱创建后补入;需要最低启动时延的项目仍可把同一
Agent 预装进起点 image / template。

```text
按 eval.environment 解析本 provider 的起点产物
 → Sandbox.create
 → sandbox.setup
 → baseline → eval.setup
 → AgentProvisioner.ensure(sandbox)
    ├─ check 通过  → 记录已命中的安装事实
    └─ check 失败  → install → check
 → test(t) → scoring
```

Ensure 属于 Agent/Adapter,不属于 `Sandbox` 核心。Sandbox
只提供执行命令、文件访问、默认用户与提权等已有能力;哪个
命令代表 Codex 可用、应安装哪个版本,仍由 Codex Adapter
拥有。Runner 只调用 Agent 生命周期,不出现 Agent 名分支。

### 配置形态

内置 Agent 带一个默认 provisioner。用户通常不写安装配置:

```typescript
defineExperiment({
  agent: codexAgent(),
  sandbox: e2bSandbox({
    environments: {
      "repo-light": { template: "acme/repo-light-v3" },
      "tb-heavy": { template: "acme/tb-heavy-v8" },
    },
  }),
});
```

两条 eval 可以在同一个 experiment 下选择不同起点:

```typescript
defineEval({ environment: "repo-light", test });
defineEval({ environment: "tb-heavy", test });
```

两个 template 都不必预装 Codex。若其中一个使用官方 Codex
template,检查直接命中;另一个只预装任务依赖,Ensure 在
`agent.setup` 安装 Codex。environment profile 继续决定任务 Sandbox,
Agent factory 继续决定 Agent,两根轴不互相接管。

需要离线宿主、内部镜像源或未内置 Agent 时,用户可以替换
provisioner:

```typescript
const internalCodex = defineAgentProvisioner({
  identity: {
    agent: "codex",
    version: "0.144.0",
    revision: "corp-2",
  },
  check: async (sandbox) => {
    const result = await sandbox.runCommand(["codex", "--version"]);
    return result.exitCode === 0 && result.stdout.includes("0.144.0");
  },
  install: async (sandbox) => {
    await sandbox.runCommand(
      ["/opt/company/install-codex", "0.144.0"],
      { root: true },
    );
  },
});

codexAgent({ provisioner: internalCodex });
```

上例是候选调用点,不把 `identity` / `check` / `install` 的
精确公开形状提前定成 Feature 契约。调用点评审时仍要决定
`check` 返回布尔还是结构化事实、内置 provisioner 是否允许
整体替换,以及自定义 Agent 是否复用同一套机械工具。

### Ensure 契约

- **检查精确身份。** `command -v` 只能证明「有一个同名
  命令」,不能证明 Sandbox 正确。检查至少涉及可执行文件、parse
  出的精确版本与 Adapter 依赖的运行条件。结果写入 attempt
  的安装事实,便于区分预装命中与本次安装。
- **不按 template 名短路。** 官方 template 也必须检查。
  Template 名、tag 或出处不是运行事实;被错误覆写的官方
  template 不能因为名字受信而绕过验证。
- **安装必须收敛。** 安装锁定精确 Agent 版本与配方修订。
  安装成功后必须重跑同一个检查;安装命令退出 0、检查仍失败
  时按 Sandbox 错误处理,不把坏 Sandbox 交给 Agent。
- **默认修复,可以只验。** 默认 `ensure` 在缺失或版本不匹配
  时安装。不可变、离线或审计的 Sandbox 可以选 `verifyOnly`;检查
  失败立即报错,不尝试联网或修改文件系统。
- **失败归 Sandbox 准备。** 检查、安装与复检都属于
  `agent.setup`;失败得到 `errored`,附缺失命令、期望版本、
  实际版本与下一步,不记成 Agent 做题 `failed`。
- **不静默降级。** 安装缺少 root、网络、包管理器或可写目录
  时点名缺项。自定义 provisioner 可以适配新的起点 OCI image 或 E2B template,内置
  provisioner 不猜一个近似命令继续跑。

### 身份、指纹与可比性

`AgentProvisioner.identity` 是纯数据,至少含 Agent、精确版本
与配方修订,进入 configHash 与 Run payload。起点构建输出仍以
对应 provider 的主 Sandbox 实例及伴随资源身份进入指纹;两者正交组合:

```text
attempt 环境身份
 = provider sandbox case 身份
 + AgentProvisioner.identity
 + 其它 resolved config
```

因此同一条 eval 可以换 template 而不改 Agent 配置;也可以
在同一 template 上换 Agent 版本。两种变化都会触发重跑。
检查得到的实际版本另作为运行事实落盘,用于核对声明身份是否
兑现,不能反过来替代规划期指纹。

没有精确版本的 `latest` 安装不参与可携带结果。内置
provisioner 不提供这条模式;用户自定义 provisioner 若无法
给出稳定身份,启动期报错,不以「安装后再看装了什么」补算
已经做过的携带决策。

### 构建期与运行时的关系

本案不建立公开 `InstallStep[]` DSL。构建脚本与运行时安装
可以使用各自原生工具,但共享同一个 Agent 身份与检查后置
条件:

- 官方 E2B template / Docker image 可以继续由 provider 原生构建脚本
  预装 Agent,发布前执行 provisioner 的检查。
- 项目自己的 template 只装任务依赖也合法;运行时 Ensure
  负责补 Agent。
- 需要自建「任务 Sandbox + Agent」的组合 image / template 时,可以调用
  provider-specific 构建工具;工具是优化投影,不是
  Sandbox 运行所需的契约本体。
- 构建命令与运行时命令不强求逐字符同源。两条路径必须声明
  同一 `identity`,并通过同一 `check`;后置条件单源比发明
  跨 provider 构建语言更小、更可验证。

Node、npm prefix、包管理器与安装目录是具体 provisioner 的
前置要求,不提升为所有 Sandbox 都必须满足的系统级契约。
内置 Node Agent 优先使用运行用户拥有的安装目录;只有确实
需要系统包时才提权。这样不会为了装一个 Agent 重写任务
镜像已有的用户、PATH 与 `/usr/local` 权限模型。

### 与逐题现场构建组合

任务 Sandbox 按内容寻址现场构建时,先得到不含 Agent 的主
Sandbox,再在既有 `agent.setup` 时点执行 Ensure:

```text
逐题 BuildKey → 构建/命中任务环境
 → 创建主 Sandbox
 → baseline → eval.setup
 → Agent check
    ├─ 已预装 → 使用
    └─ 缺失   → install → check
 → test(t)
```

Sandbox BuildKey 只认题目 Dockerfile、Compose、build context、
基座与任务 Sandbox 构建器修订;Agent 身份单独进入 attempt 指纹。
因此数百份逐题 Sandbox 不会再乘上 Codex / Claude Code 等 Agent
版本形成image 或 template 组合矩阵。同一份题目构建输出可以被多个 Agent
experiment 消费,每个 Agent 在主 Sandbox 内自行检查或安装。

Provider 仍可选择把常用 Agent 预装进构建输出,但这是一项
带 Agent identity 的派生 cache。命中时 Ensure 检查通过;
未命中时回到任务起点构建输出再装 Agent。框架不要求维护者为了
运行一条新题,先发布 `<题目 × Agent>` 的 template alias。

多容器 case 中 Ensure 必须作用于 `mainService` 包装出的主
Sandbox,不能装到外层 DinD VM。Sidecar 不安装 Agent,也不向
Agent 暴露文件 API;这条边界保证隔离服务、漏洞靶机和真实
网络题的隔离语义不被安装流程破坏。

### Sandbox 复用

Runner 仍按现有契约每 attempt 调 Agent `setup`;Ensure 自身
必须可收敛。复用沙箱第一次安装后,后续 attempt 的检查快速
命中。安装文件放在 workdir 外的 Agent 自有目录,题间 reset
不删除;Agent 配置与任务 workspace 仍逐 attempt 重建。

不同 environment profile 不共享 Sandbox,也不共享安装文件。
这使同一个 experiment 可以同时运行多个 template,不会因为
一条依赖较重的 eval 安装过 Codex,让另一条 eval 的错误状态继承它。

### 优势

- **两种范式同路。** 「Agent 预配置」与「Sandbox 预配置、
  Agent 后装」分别对应同一 Ensure 协议的命中与未命中,
  两者都是完整支持路径。
- **任意 template 可用。** eval 只选择任务 Sandbox;不必为每个
  重型 Sandbox 先派生一份预装 Agent 的 image / template 才能开始评测。
- **自定义完整。** 自定义 provisioner 同时拥有身份、检查与
  安装,不是只有 E2B 构建期半边。
- **核心中立。** 安装知识留在 Adapter,Sandbox 知识留在 Sandbox
  provider,Runner 只执行既有生命周期。
- **没有跨 provider DSL。** 构建优化保留 provider 原生
  形态,运行时只依赖已经存在的 Sandbox 命令接口。

### 缺点

- 未预装 Agent 的冷启动会付安装成本;不复用时每个 attempt
  都可能重复安装。官方构建输出、项目自建构建输出、Sandbox 复用与
  checkpoint 仍是解决性能问题的工具。
- 安装期需要网络或内部安装包源;离线场景必须预装或提供自定义
  provisioner,不能由框架凭空解决。
- `check` 是真正的兼容边界。只比版本字符串会放过 PATH、
  运行用户或依赖损坏;检查太重又会增加每 attempt 固定成本。
- 构建期与运行时命令不强制单源,可能漂移。发布门与运行时
  复检能发现漂移,但不能像命令 DSL 那样从结构上消灭重复。

---

### 落地路线

1. 定 `AgentProvisioner` 的内部身份、检查结果与 Ensure
   状态机;先让一个内置 Agent 贯通预装命中与运行时安装。
2. Adapter 现有安装逻辑迁入 provisioner;官方 template
   收为同样先检查,删除按 template 出处假定已安装的分支。
3. 安装身份进入 configHash / Run payload,实际检查事实写入
   attempt Record;补 `agent.setup` 的结构化错误。
4. Codex、Claude Code 等内置 Sandbox Agent 逐个迁移;
   每家保留自己的依赖探测与用户目录策略。
5. 开放自定义 provisioner 调用点,完成 API 设计评审。
6. 官方 template 构建发布门改为调用同一检查;再评估是否
   需要 E2B / Docker 的 provider-specific 构建工具。
7. 与多容器按需构建 case 联调:任务 Sandbox cache 可跨 Agent
   共用,Ensure 始终只修改本 attempt 的主 Sandbox。

---

### 验收 / Definition of Done

1. **官方命中。** 官方 Codex template 上只执行检查,零安装
   动作,实际版本事实与声明身份一致。
2. **重任务后装。** 一个只有任务依赖、没有 Node 与 Codex
   的 apt + glibc template 能在 `agent.setup` 安装并复检,
   随后完成 eval。
3. **自建预装。** 非官方 template 预装了正确 Codex 时同样
   检查命中;框架不因出处非官方而重复安装。
4. **坏预装修复。** template 带错版本时默认 Ensure 修复到
   锁定版本;`verifyOnly` 则创建后立即 `errored`,两者都不
   把错误版本交给 Agent。
5. **多 environment。** 同一 experiment 的两条 eval 定位到
   不同 template,各自独立 Ensure;安装事实与指纹不串组。
6. **自定义入口。** 用户 provisioner 从内部安装包源安装一个
   未内置 Agent,检查、错误与登记形态和内置实现一致。
7. **复用。** 同一 profile 的复用 Sandbox 只在第一次安装,
   后续 attempt 检查命中;换 profile 不共享安装文件。
8. **逐题构建正交。** 改任务 Dockerfile 只重建 Sandbox;改
   Agent 版本只改变 Ensure identity。两根轴都触发结果重跑,
   但不会强制发布二者笛卡尔积的 template。

**反指标**:

- 看到官方 template 名就跳过检查,registry 中同名坏 image / template 被
  当作可用 Sandbox。
- 为运行时安装要求所有任务镜像统一 `/usr/local`、统一
  包管理器或统一默认用户。
- eval 的 environment profile 开始携带 Agent 名,或 Sandbox
  spec 开始决定应该安装哪个 Agent。
- 自定义 Agent 只能写构建中间件,运行时仍需复制 Adapter
  私有安装逻辑。

---

### 和其它方案的关系

- **vs PLAN-1 / PLAN-2**:两案把构建期组合当本体,本案把
  运行时后置条件当本体。原有工厂和中间件仍可作为预构建
  优化,但不再决定任意 template 能不能运行 Agent。
- **vs PLAN-3**:两案都让预装检查与运行时安装同路。PLAN-3
  用中性步骤 DSL 强求命令单源;本案只单源身份与检查,允许
  构建、Dockerfile 与 Sandbox exec 使用原生实现。
- **与多容器 PLAN-4**:environment profile 在 provider spec
  中选择完整的主 Sandbox 实例及伴随资源;它产出主 Sandbox 后,本案的 Ensure
  再决定 Agent 是检查命中还是安装。两层按固定顺序组合,
  不互相复制配置。
