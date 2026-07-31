# 环境层 —— 重环境的一等声明,产物退为缓存

三个真实项目形态暴露了同一个设计缺口:

1. **题目环境重**(terminal-bench):241 道题各带 Dockerfile / Compose,agent 现场装。
2. **agent 侧环境重**(记忆对照 + mempal):所有题共用轻底座,重的是条件工具——二进制、模型 cache、skill 文件。
3. **两头都重**:每题底座 × 每条件工具,不可能为每个组合造 template。

形态 1 有一等声明:eval 的 `environment` 进 CaseKey、有携带门、缺能力时显式 `skipped`。
形态 2 什么都没有,用户被迫用三件东西凑:

- **条件专属 template**:手工维护「agent × 条件」的派生模板命名(`mempalTemplate("codex")` 这类),base 或工具版本一变就要重编名字重构建;
- **命令式 `sandbox.setup()` Hook**:装二进制、预热模型都塞在这里,没有 check-first 协议,每 attempt 重付,大预热还会撞 attempt 超时;
- **身份寄生在 flags**:环境到底装了什么、什么版本,靠 `flags: { memory: "mempal" }` 和 template 命名约定双轨背书,fingerprint 拿不到真实的环境身份。

形态 3 则直接无解:template 乘法炸成「题目 × 条件」制品矩阵,Hook 又没有幂等协议。
本篇提出重构:**把「装在底座之上、有身份的环境内容」收敛成一个一等原语——层(Layer)**。

## 契约:环境 = 底座 + 层栈 + Fixture

每条 attempt 的环境由三部分叠成:

| 部分 | 是什么 | 归谁声明 |
| --- | --- | --- |
| 底座 | OS、运行时、题目服务(image / template / snapshot / Compose) | eval 的 `environment`;沉默时落 spec 默认产物 |
| 层栈 | 装在底座之上、有身份的内容:agent CLI、条件工具 | adapter 自带 agent 层;experiment 的 `layers` 声明条件层 |
| Fixture | 起始文件、判分材料 | `EvalDef.setup` / `test(t)`,运行时铺 |

底座与 Fixture 沿用现行契约([Sandbox Case](../../feature/sandbox/case.md)、[环境预置放哪](../../feature/sandbox/library.md#环境预置放哪))。
新东西只有中间那行。

### 层:身份 + 检查 + 补齐

```typescript
import { defineLayer } from "niceeval/sandbox";

export const mempal = defineLayer({
  identity: { name: "mempal", version: "0.9.0" },   // 纯数据,进 fingerprint
  check: async (sandbox) =>
    (await sandbox.runCommand("mempal", ["--version"])).stdout.includes("0.9.0"),
  apply: async (sandbox, ctx) => {
    ctx.progress({ message: "installing mempal" });
    await sandbox.runShell(MEMPAL_INSTALL_SH);       // check 未命中才执行
  },
});
```

每一层走同一条协议:**检查 → 缺失时补齐 → 复检**。
这就是 [Agent Ensure](../../feature/adapters/architecture/agent-ensure.md) 的协议,推广到任意环境内容;adapter 的 agent 安装从「特例机制」变成「adapter 自动贡献的一个层」,runner 对 agent 层与条件层跑同一段代码。

```typescript
export default defineExperiment({
  agent: codexAgent({ mcpServers: [mempalMcp] }),
  sandbox: e2bSandbox({ template: NICEEVAL_CODEX_E2B_TEMPLATE }),
  layers: [mempal],        // 条件工具的一等家:身份进指纹,底座是谁都能补齐
});
```

`layers` 是有序列表:按序 apply,身份序列按序进 fingerprint。
`identity` 必须可序列化;`check` / `apply` 函数体不参与哈希——与自定义 sandbox case 同一条纪律,身份靠声明,不靠 `toString()`。

### 产物是缓存,层是真相

这是本设计的核心翻转。
旧指引说「稳定大依赖先做进 image / template / snapshot」——产物是语义的一部分,于是组合多了就必须造产物矩阵。
新契约里**语义的唯一来源是声明:底座声明 + 层栈声明**;预制产物只是让 `check` 命中的缓存:

- 任何「底座 × 层」组合都能纯运行时物化——你**永远不被迫**造新 template;
- 想省热路径的安装耗时,把常用层烘进常用底座即可,check 命中零动作;
- 烘错了、烘旧了不产生静默偏差:check 不命中就现场补齐到声明的版本。

制品从「组合的笛卡尔积」变成「热路径前缀的缓存」。
形态 3 因此直接可跑:每题底座照常物化,条件层在其上补齐,零新增产物。

### 身份与携带:如实,不投机

attempt 的环境身份 = 底座身份(CaseKey / 产物 digest)+ 层 identity 序列,整体进 fingerprint 与携带门。
两条如实规则:

- 换底座产物(哪怕只是把工具烘了进去)就是换了底座身份,旧结果不携带。
  层命中检查省的是**时间**,不是**身份**;不做「声明相同就当同一环境」的投机等价。
- 条件身份不再需要寄生:flags 回归「计划内自变量」的本职,`flags: { memory: "mempal" }` 可以继续存在用于分组展示,但环境的真实身份由层声明承载。

### 计时、错误与预算

层的 apply 计时挂 attempt 生命周期锚点,逐层记录——「哪一层花了多久」在记录里可见。
apply 或复检失败按基建错误计(`errored`),锚点点名具体层,与 `agent.setup` 失败同型,不折叠成 agent `failed`。
一个层的 apply 稳定花分钟级(模型预热这类),这本身就是「把它烘进产物」的信号,记录里的逐层计时就是决策依据。

## Hook 收窄:只剩状态,不再装环境

`sandbox.setup()` / `.teardown()` 的现行职责里,「装二进制、预热」整块搬进层。
Hook 链保留,但契约收窄为**每沙箱的状态动作**:载入 / 回存记忆状态、起停日志转发这类「不是环境内容、每个沙箱都要做」的事。
niceeval 是 beta,这是刻意的破坏性收窄:定稿后重写 [Sandbox Library](../../feature/sandbox/library.md) 对应小节与其中的安装类示例,不留两种写法并存的含混期。

## 待裁决分歧

- **状态对挂哪。**
  候选一:留在 spec 的 Hook 链(本篇现稿)。
  候选二:层自带可选 `state: { load, save }`,让「mempal 的安装」和「mempal 的状态」在同一个声明里成对出现。
  倾向候选二再评一轮:成对声明更内聚,但会让层从「环境内容」膨胀成「环境 + 生命周期」双职责。
- **产物要不要声明 `contains`。**
  给产物登记「已含哪些层」可以省掉逐层 check 的往返,还能让规划期在多个产物里挑最优起点。
  倾向第一版不做:check 本身就是命中判定,`contains` 是纯优化,等逐层计时证明 check 成本显著再加。
- **eval 轴要不要也能挂层。**
  题目级依赖(某题要 openjdk)留在底座声明(Dockerfile)或 Fixture 代码,不给 eval 开 `layers`。
  倾向维持:底座已是 eval 的一等声明,再开一轴会让「题目环境」有两个家。
- **定稿后的落点与迁移面。**
  层原语落 `docs/feature/sandbox/`;Agent Ensure 一篇改写为「agent 层」的特化说明;`experiments/library.md` 与 `sandbox/library.md` 的安装类示例全部改写。

## 相关阅读

- [Library](library.md) —— 三个真实形态在新契约下的完整写法。
- [Sandbox Case](../../feature/sandbox/case.md) —— 底座物化的现行契约:双入口、两张表、BuildKey / CaseKey。
- [Agent Ensure](../../feature/adapters/architecture/agent-ensure.md) —— 协议原型;本设计把它推广成层协议。
- [Experiments · 缓存与携带](../../feature/experiments/cache.md) —— 层身份序列进入 fingerprint 的挂点。
