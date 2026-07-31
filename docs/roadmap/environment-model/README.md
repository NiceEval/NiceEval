# 环境层 —— 重环境的一等声明

三个真实项目形态暴露了同一个设计缺口:

1. **题目环境重**(terminal-bench):241 道题各带 Dockerfile / Compose,agent 现场装。
2. **agent 侧环境重**(记忆对照 + mempal):所有题共用轻底座,重的是随 experiment 变的工具——mempal 的二进制、模型 cache、skill 文件。
3. **两头都重**:每题底座 × 每实验各自的工具,不可能为每个组合造 template。

形态 1 有一等声明:eval 的 `environment` 进 CaseKey、有携带门、缺能力时显式 `skipped`。
形态 2 什么都没有,用户被迫用三件东西凑:

- **实验专属 template**:手工维护「agent × 实验变体」的派生模板命名(`mempalTemplate("codex")` 这类),base 或工具版本一变就要重编名字重构建;
- **命令式 `sandbox.setup()` Hook**:装二进制、预热模型都塞在这里,没有 check-first 协议,每 attempt 重付,大预热还会撞 attempt 超时;
- **身份寄生在 flags**:环境到底装了什么、什么版本,靠 `flags: { memory: "mempal" }` 和 template 命名约定双轨背书,fingerprint 拿不到真实的环境身份。

形态 3 则直接无解:template 乘法炸成「题目 × 实验变体」制品矩阵,Hook 又没有幂等协议。
本篇提出重构:**把「装在底座之上、有身份的环境内容」收敛成一个一等原语——层(Layer)**。

## 契约:环境 = 底座 + 层栈 + Fixture

每条 attempt 的环境由三部分叠成:

| 部分 | 是什么 | 归谁声明 |
| --- | --- | --- |
| 底座 | OS、运行时、题目服务(image / template / snapshot / Compose) | eval 的 `environment`;沉默时落 spec 默认产物 |
| 层栈 | 装在底座之上、有身份的内容:mempal 这类实验工具、agent CLI | experiment 的 `layers` 声明 experiment 层;adapter 自带 agent 层 |
| Fixture | 起始文件、判分材料 | `EvalDef.setup` / `test(t)`,运行时铺 |

底座与 Fixture 沿用现行契约([Sandbox Case](../../feature/sandbox/case.md)、[环境预置放哪](../../feature/sandbox/library.md#环境预置放哪))。
新东西只有中间那行。

## 层:身份、检查、补齐、准备、要求

```typescript
import { defineLayer } from "niceeval/sandbox";

export const mempal = defineLayer({
  name: "mempal",                               // [a-z0-9-];层栈内唯一,记录 key 用它
  identity: {
    version: "0.9.0",
    recipeRevision: 3,                          // 安装配方改了但版本没变时,人工递增
    installerDigest: MEMPAL_INSTALL_SH_SHA256,  // 安装脚本内容摘要,用户代码现算
    model: "minilm-l6@sha256:9f2c…",            // 预热的模型也是环境语义,进身份
  },
  requires: { network: "direct" },              // apply 需要沙箱侧外网;规划期协商用
  check: async (sandbox) => {
    const probe = await sandbox.runCommand("mempal", ["--version"]);
    if (probe.exitCode !== 0) return { ok: false, reason: "missing" };
    const actual = probe.stdout.trim();
    if (!actual.includes("0.9.0")) return { ok: false, reason: "version-mismatch", detail: actual };
    return { ok: true, actual: { version: actual } };
  },
  apply: async (sandbox, ctx) => {
    ctx.progress({ message: "installing mempal" });
    await sandbox.runShell(MEMPAL_INSTALL_SH);
  },
});
```

### 身份契约:覆盖一切有语义的输入

`identity` 是纯数据、整体进 fingerprint;`check` / `apply` / `prepare` 函数体不参与哈希——与自定义 sandbox case 同一条纪律。
正因为函数体不哈希,契约必须把举证责任压实到声明上:**apply 消费的每一个有语义的输入,都必须在 identity 里有对应字段**。
具体义务:

- 安装脚本 / staged 制品:内容摘要进身份(`installerDigest` 这类),用户代码在模块顶层现算,改一个字节就换身份;
- 预热产物(模型、数据集):其版本或 digest 进身份;
- 无法给出内容摘要的输入(内部制品源、私有下载):用户必须提供人工递增的 `recipeRevision`,与 [Sandbox Case](../../feature/sandbox/case.md#buildkey-与-casekey两个身份各管一件事) 里凭据 `revision` 的规则同型;
- 身份含无法解析成稳定值的引用(浮动 tag、`latest`)时,该层参与运行与记录,但**旧结果不参与携带**——与底座浮动 tag 的规则一致。

`{ name, version }` 两个字段就想代表一整套安装是不合格的声明:版本没变、脚本变了,旧结果照样携带,身份就是假的。

### check 的返回是结构化结果,不是布尔

```typescript
type LayerCheckResult =
  | { ok: true; actual?: Record<string, string> }          // 实测身份,落 facts
  | { ok: false; reason: string; detail?: string };        // reason 是开放诊断词表
```

只有 `false` 区分不了「命令缺失 / 版本不符 / 权限不足 / 依赖损坏」,错误就无法点名。
`ok` 是判别轴,`reason` 是开放词表(`missing` / `version-mismatch` / `permission` / …),与 [Agent Ensure](../../feature/adapters/architecture/agent-ensure.md) 的结构化检查结果同源,协议统一不是一句比喻。
`actual` 与 `detail` 会落盘,因此是**非敏感**数据:不整段转储 stderr,写提炼后的短值;token、内网地址不进这两个字段,义务与「凭据值不落盘」同一条;框架另做固定长度截断,截断只管体积,不代替脱敏。

### 写入边界:层不写 workdir

层是**环境内容**,落点在 workdir 之外(PATH 目录、home、系统路径)。
workdir 只属于 Fixture 与 agent——层写了 workdir,安装物就会混进 diff 归因与复用重置语义,两边一起坏。
要往工作区放文件的是 Fixture(`EvalDef.setup` / `test(t)`),不是层。
这条边界让层与 baseline / diff / reset 完全无交集:复用沙箱上层的修复动作不会被工作区重置回滚,baseline 也不因层的 apply 重建。

## 协议:检查 → 缺失补齐 → 全栈复检

单层协议是「check → 未命中则 apply → 复检」。
但逐层复检只能证明**每个前缀曾短暂成立**:后面的层可能覆盖前一层的二进制、运行时或配置。
所以层栈的完成判定是**全栈复检**:所有 apply 结束后,按执行序对**每一层**再跑一遍 check,全部 `ok` 才算层栈就绪。
成本上不是新增负担:第一遍 check 本来就要逐层跑,全栈复检把同样的检查在终态再执行一次,换来的是「fingerprint 声称的身份序列在 attempt 开始时真实成立」。

复检失败的归责要给作者指对对象:attempt `errored`,报错点名**复检失败的层**(带它的 `reason`),并列出**该层上一次 check 通过之后执行过 apply 的层**——破坏者只可能在这份名单里。
只报失败层会引导作者去修一个没坏的东西;有了执行序与逐层 check 结果,这份名单是现成推导,不需要新的依赖声明机制。

否决的替代方案:层间冲突声明 + 拓扑排序(为想象中的复杂依赖提前造 DSL),以及强制每层写入隔离命名空间(装 CLI 本来就要动共享的 PATH 与运行时,隔离不成立)。
全栈复检不阻止层互相覆盖,只保证覆盖破坏了声明时**看得见、报得准**。

## 生命周期位置

### agent 生命周期拆成两段

[Agent Ensure](../../feature/adapters/architecture/agent-ensure.md) 的「检查→安装→复检」段抽出来成为 **agent 层**(adapter 自动贡献,内容是 CLI 与其运行依赖就位);`agent.setup` 保留其余职责——鉴权、写 agent 配置、MCP 注册,这些要在层栈与状态就绪后、贴着运行发生。
拆分的判据:装东西是环境内容(有身份、可预制、可命中),连接与配置是每 attempt 的运行动作(依赖运行时坐标,不可预制)。

### 两张顺序表

setup 侧:

| 步 | 动作 | 频次 |
| --- | --- | --- |
| 1 | 底座启动:从 image / template / snapshot 启动 sandbox case、等待服务 ready | 每沙箱 |
| 2 | 层栈:experiment 层按 `layers` 声明序,agent 层在最后;逐层 check → 缺失 apply | check 每 attempt;apply 仅未命中 |
| 3 | 全栈复检:按执行序全量 check,失败即 `errored` | 每 attempt |
| 4 | 状态 Hook:spec `.setup()` 链(收窄后只做状态动作) | 每沙箱 |
| 5 | `agent.setup`:鉴权、配置、MCP 注册 | 每 attempt |
| 6 | `EvalDef.setup` 与 `test(t)`:Fixture、send 循环 | 每 attempt |

teardown 侧,与 setup 严格成对逆序:

| 步 | 动作 |
| --- | --- |
| 6′ | `EvalDef.teardown` |
| 5′ | `agent.teardown` |
| 4′ | 状态 Hook:spec `.teardown()` 链(回存) |
| 2′ | 层无 teardown:环境内容随沙箱销毁 |
| 1′ | 沙箱销毁 / 资源组回收 |

状态回存在 `agent.teardown` **之后**——镜像 setup 侧「状态先于 agent 配置」的成对关系。
要在 agent 存活期采集的观测(还开着的 session、临终 transcript)不属于状态回存,放 `EvalDef.teardown` 或 adapter 的 `preTeardown`。

### 顺序裁决与理由

- **experiment 层在前,agent 层在后。**
  experiment 层可能补齐 agent 安装的前置(内部 registry 配置、运行时组件);反向依赖不存在——mempal 这类工具面向环境,不面向某个 agent CLI。
  顺序仍是静态固定的,不引入依赖求解;真有更复杂的依赖时先写成一个合并层。
- **层栈与状态 Hook 都先于任何变更分类账 baseline。**
  配合「层不写 workdir」,层对 diff 归因是双保险:时序上先于 baseline,空间上不碰工作区。
- **状态 Hook 从「底座就绪后、agent setup 前」的现行位置移到层栈之后。**
  状态动作(载入记忆、恢复 checkpoint)要用层装好的工具,放在层栈前是倒置的。
  定稿时同步改写 [Runner · 环境预置](../../runner.md#环境预置不进运行器但按顺序调它) 的顺序声明。

### 复用语义:层每 attempt,状态每沙箱

`sandboxReuse` 下,check 每 **attempt** 执行(幂等,防上一条 attempt 破坏环境后带病复用),apply 只在未命中时执行——复用沙箱上通常全命中、零动作。
状态 Hook 保持每沙箱一次:**这是刻意的批次语义**——沙箱是状态承载体,复用窗口内的 attempt 直接读写沙箱内的活状态,载入 / 回存只发生在沙箱边界。
要求逐 attempt 快照的实验不开 `sandboxReuse`,或在 `EvalDef` 生命周期里自己做逐题快照。

## staged 准备:`prepare` 是层的宿主侧半边

「制品在题面网络之外准备再送入」不是一个网络枚举值能表达的:它需要宿主侧动作、上传能力与制品身份。
层用可选的 `prepare` 承载:

```typescript
const mempalStaged = defineLayer({
  name: "mempal",
  identity: { version: "0.9.0", payloadDigest: MEMPAL_TARBALL_SHA256 },
  prepare: async (ctx) => {
    // 宿主侧跑,run 级共享准备:同 identity 只执行一次(single-flight),产物给全部 attempt 复用
    const tarball = await downloadMempalRelease("0.9.0");
    return { files: { "mempal.tar.gz": tarball } };
  },
  apply: async (sandbox, ctx) => {
    await sandbox.uploadFile("/opt/staged/mempal.tar.gz", ctx.prepared.files["mempal.tar.gz"]);
    await sandbox.runShell("tar -xzf /opt/staged/mempal.tar.gz -C /usr/local && mempal --install-offline");
  },
});
```

- `prepare` 归 **run 级共享准备**:以层 identity 做 single-flight,预算、取消与失败止损跟 BuildKey 构建同一套(见 [Sandbox Case · Run 级构建协调](../../feature/sandbox/case.md#run-级构建协调共享准备的预算与调度));它失败时依赖该层的 attempt 统一 `errored`,不逐条重试下载。
- 产物经 `ctx.prepared` 交给 apply,身份义务照旧:`payloadDigest` 进 identity。
- 有 `prepare` 且 apply 不再要外网的层,`requires` 就不声明 `network`——staged 是「prepare + 无网络要求」的组合,不是第三种网络值。

## 能力协商与失败分层

`requires` 是层对底座与 provider 的前置要求,纯数据,规划期做交集:

```typescript
requires: {
  platform: ["linux/amd64", "linux/arm64"],   // 省略 = 不挑平台
  root: true,                                  // 需要提权执行;省略 = 不需要。没有「禁止 root」这种层需求
  network: "direct",                           // apply 需要沙箱侧外网;省略 = 不需要
}
```

协商只做**静态可判**的一侧:case 声明了无网(Compose `network_mode: none` 这类)而层要 `direct`,规划期 `skipped`;「有网」没有静态证明,运行期断网按 apply 执行失败归属,不是规划期义务。
同理,同一个层能复用到的是**能力相容的底座**,不是任何底座——断网题跑要 `direct` 的层,得到的就是计划期 `skipped`,换 staged 变体才能跑。

| 失败点 | 结果 | 归属 |
| --- | --- | --- |
| `requires` 与 provider / case 能力规划期不相交 | 计划期 `skipped` | skipReason 点名层、缺项与可补位置;全 `skipped` 升级启动期报错 |
| `prepare` 失败(下载、发布) | 依赖它的 attempt `errored` | run 级共享准备,同 BuildKey 失败的止损形态 |
| apply 执行失败 / 全栈复检失败 | attempt `errored` | attempt 锚点点名具体层、`reason` 与嫌疑层名单 |

## 产物与身份:不被迫造产物,但产物不是免费换的

层原语消灭的是「**被迫**造产物」:任何「底座 × 层」组合都能在 Sandbox 启动后现场安装,组合再多也不需要制品矩阵;把常用层预装进 image / template / snapshot,只是让 check 命中、省掉安装时间的优化。

但**底座产物本身是环境语义,不是透明缓存**。
attempt 的环境身份 = 底座身份(CaseKey / 产物 digest)+ 层 identity 序列,整体进 fingerprint 与携带门;换底座产物(哪怕只是把工具烘了进去)就是换环境,旧结果不携带。
曾考虑把身份拆成「语义身份(层声明)+ 物理身份(仅作 provenance)」,让复检通过后换产物不作废可比性——否决:层的 check 只覆盖层自己声明的内容,底座里其余一切(系统包、运行时配置)都在检查之外,声称「复检通过即语义等价」是投机。
因此换产物的正确时机是**实验代际之间**:先纯运行时把实验跑对、拿逐层计时,决定烘什么;烘完切换产物、接受一次全量重跑,新代际内享受命中。

flags 回归「计划内自变量」的本职:`flags: { memory: "mempal" }` 可以继续存在用于分组展示,环境的真实身份由层声明与底座身份承载。

## 记录形状:逐层计时与运行事实

- 层的 `name` 限 `[a-z0-9-]`,同一层栈内(含 agent 层)唯一,重复在启动期按配置错误一次穷举报出——它是记录 key 的组成部分,不唯一则计时与 facts 互相覆盖。
- 每层的 check 与 apply 各是一个 activity,key 挂在现有 `sandbox.*` 命名空间下:`sandbox.layer.<name>.check` / `sandbox.layer.<name>.apply`。
  不新增顶层 activity 词条,落盘走 [Record · 两层时间模型](../../feature/record/architecture.md#两层时间模型生命周期锚点与开放-activity) 的开放 activity 机制。
- check 的 `actual` 与命中与否落 `AttemptRecord.facts`(`layer.mempal.hit`、`layer.mempal.version` 这类),事后可审计「这次到底是命中还是现场装的」。
- 一个层的 apply 稳定花分钟级,逐层计时就是「把它烘进产物」的决策依据。

## Hook 收窄:只剩状态,不再装环境

`sandbox.setup()` / `.teardown()` 的现行职责里,「装二进制、预热」整块搬进层;Hook 链保留,契约收窄为**每沙箱的状态动作**——载入 / 回存记忆状态、起停日志转发这类「不是环境内容、每个沙箱都要做」的事。
执行位置随收窄移到层栈之后(见「生命周期位置」)。
niceeval 是 beta,这是刻意的破坏性收窄:定稿后重写 [Sandbox Library](../../feature/sandbox/library.md) 对应小节与其中的安装类示例,不留两种写法并存的含混期。

## 已否决:`sandbox.native` 原生出口

层不提供、也不依赖任何「拿到 provider 原生 SDK 实例」的出口;层的全部操作走中性 `Sandbox` 接口,这是「同一层在能力相容的底座间复用」的前提。
`sandbox.native` 与「包装层透明转发未知方法」已整体否决:原生出口绕开 deadline、timing、路径归一化与资源组回收,`unknown` 类型只是鼓励跨 provider 的错误 cast;接口外能力的正路是显式建模(接口可选成员或 case 能力句柄)加包装层保留义务。
完整理由见 [memory 裁决](../../../memory/sandbox-native-escape-hatch-rejected.md)与 [Sandbox Architecture · 实现纪律](../../feature/sandbox/architecture.md#实现纪律)。

## 待裁决分歧

- **状态对挂哪。**
  候选一:留在 spec 的 Hook 链(本篇现稿)。
  候选二:层自带可选 `state: { load, save }`,让「mempal 的安装」和「mempal 的状态」在同一个声明里成对出现。
  倾向候选二再评一轮:成对声明更内聚,但会让层从「环境内容」膨胀成「环境 + 生命周期」双职责。
- **`requires` 要不要收磁盘与制品体积声明。**
  取决于 `prepare` 的共享准备是否需要预算控制,待第一个实现回合定。
- **产物要不要声明 `contains`。**
  给产物登记「已含哪些层」可以省掉逐层 check 的往返,还能让规划期在多个产物里挑最优起点。
  倾向第一版不做:check 本身就是命中判定,`contains` 是纯优化,等逐层计时证明 check 成本显著再加。
- **eval 轴要不要也能挂层。**
  题目级依赖(某题要 openjdk)留在底座声明(Dockerfile)或 Fixture 代码,不给 eval 开 `layers`。
  倾向维持:底座已是 eval 的一等声明,再开一轴会让「题目环境」有两个家。
- **定稿后的落点与迁移面。**
  层原语落 `docs/feature/sandbox/`;[Agent Ensure](../../feature/adapters/architecture/agent-ensure.md) 按「agent 生命周期拆两段」改写;[Runner · 环境预置](../../runner.md#环境预置不进运行器但按顺序调它) 的顺序表、`experiments/library.md` 与 `sandbox/library.md` 的安装类示例全部改写。

## 相关阅读

- [Library](library.md) —— `defineLayer` / `experiment.layers` 的 API 面。
- [用例手册](use-case/README.md) —— 三个真实形态与烘产物的完整代码路径。
- [Sandbox Case](../../feature/sandbox/case.md) —— 底座构建与启动的现行契约:双入口、两张表、BuildKey / CaseKey、错误归属、Run 级共享准备。
- [Agent Ensure](../../feature/adapters/architecture/agent-ensure.md) —— 协议原型;本设计把它推广成层协议。
- [Experiments · 缓存与携带](../../feature/experiments/cache.md) —— 层身份序列进入 fingerprint 的挂点。
