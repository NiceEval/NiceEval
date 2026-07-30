# PLAN-3 —— 配方单源:一份配方、两种执行时机

**相关文档**:[README](README.md) · [GOALS](GOALS.md) ·
[LIMITS](LIMITS.md) · [PLAN-1](PLAN-1.md) · [PLAN-2](PLAN-2.md) ·
[DECISION](DECISION.md)

---

## 实现方案 3(配方单源,是否推荐见 [DECISION](DECISION.md))

### 简述

在 PLAN-2 的拆分之上再走一步:安装配方不再以「E2B builder
中间件」为本体,而是一份中性的 recipe 数据——安装步骤、
版本、校验命令——由三个消费者各自渲染:

```typescript
interface AgentInstallRecipe {
  agent: string;                 // 指纹与版本常量的键
  install: InstallStep[];        // 中性步骤:runAsRoot / runAsUser / ensurePackages
  verify: string;                // 幂等短路与安装后自检共用:如 `codex --version`
}
```

- **E2B 构建期**:`withCodingAgent` 把 recipe 渲染成
  builder 步骤(PLAN-2 的中间件成为 recipe 的一个渲染器)。
- **运行时回退**:adapter 的回退安装渲染同一份 recipe 为
  沙箱 exec,先跑 `verify` 幂等短路——Harbor 验证过的形态
  ([LIMITS](LIMITS.md)),预装环境自动成为快速路径。
- **Docker / Vercel**:recipe 渲染成 shell 片段导出,
  Dockerfile `RUN` 与 Vercel 构建脚本直接引用,Node 工具
  契约从此有唯一出处。

### 优势

- **R4 达成**:版本与命令都单源,改一处三个执行面同步;
  「预装与回退装的是同一版」从约定升格为机制。
- **R5 完整达成**:自定义 agent 提供一份 recipe,构建期、
  运行时回退与 Docker 片段三个面同时获得,不再只有构建期
  半边。
- **R6 达成**:shell 片段是 provider 原生词汇,引用不
  手抄。
- R1 / R2 / R3 由所含的 PLAN-2 部分承担,结论相同。

### 缺点

- **中性步骤词汇表是一个小 DSL**:`ensurePackages` 要定义
  跨包管理器的语义,与
  [不发明跨 provider 构建 DSL](../../feature/sandbox/library/prebuilt-environments.md#为什么没有跨-provider-构建-dsl)
  的裁决有张力。辩护是范围:它只覆盖「装一个 agent CLI」
  这一窄面,产物构建、发布与消费仍归 provider 原生工具;
  但词汇表一旦公开,每个新步骤类型都是永久契约面,这个
  张力必须在采纳时摊开。
- 三个渲染器 × 步骤词汇表的测试矩阵,维护成本显著高于
  PLAN-2 的单渲染器。
- 运行时回退的现有实现要迁移到 recipe 渲染,迁移期两份
  实现并存,正是 R4 要消灭的状态,须一次换完。
- 收益里有两项((R4 的命令双份、R5 的运行时半边)当下
  没有活的需求方:内置 agent 的安装命令变更频率低,未内置
  agent 的接入请求还没有出现过。为没有需求方的收益预付
  DSL 契约面,时机存疑。

---

### 架构 / 数据流

```text
AgentInstallRecipe(内置六家 + 用户自定义)
 ├─ E2B 渲染器    → withCodingAgent(PLAN-2 中间件,改为读 recipe)
 ├─ exec 渲染器   → adapter 回退安装(verify 幂等短路在前)
 └─ shell 渲染器  → 导出片段,Dockerfile / Vercel 脚本引用
共享:版本常量、verify 命令、指纹语义
```

---

### 落地路线

1. PLAN-2 全部(前置)。
2. 定步骤词汇表与 recipe 类型,内置 agent 配方迁入。
3. exec 渲染器替换 adapter 回退安装的手写命令,一次换完。
4. shell 渲染器与导出;Docker 公共基线 Dockerfile 改为
   引用产出片段。
5. 自定义 recipe 的公开面与文档。

---

### 验收 / Definition of Done

1. **单源生效(R4)**:改一个内置 agent 的版本常量,构建
   模板、运行时回退与导出片段三处装到同一新版本,无第二处
   代码改动。
2. **幂等短路**:预装匹配的环境上回退安装零安装动作,
   `verify` 一次通过。
3. **自定义完整口子(R5)**:未内置 agent 的用户 recipe
   在三个执行面各跑通一次。
4. **片段可引用(R6)**:Docker 公共基线从导出片段构建,
   产出镜像过既有基线验证。

**反指标**:

- exec 渲染器与 E2B 渲染器对同一步骤产生语义不同的命令
  ——单源变成假单源,比两份手写更难排查。
- 步骤词汇表为个别 agent 的特例膨胀——DSL 张力失控的
  信号,应退回该 agent 用原生 escape hatch。

---

### 和其它方案的关系

- **vs PLAN-2**:严格递进,包含其全部;分歧只在「配方
  本体是中间件还是数据」与付出时机。
- **vs PLAN-1**:PLAN-1 的配方藏在工厂体内,无法作为本案
  前置。
