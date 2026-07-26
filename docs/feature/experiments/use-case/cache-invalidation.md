# 改什么会作废缓存:用例手册

跑过一轮之后再跑同一条命令,终态结果默认携带、不重花钱。这篇按场景回答两个问题:**我改的这个东西会不会让已完成的结果重跑**,以及**它重跑了但我不想让它重跑,怎么办**。指纹输入的穷尽清单与携带判据单源在 [Runner · 缓存](../../../runner.md#缓存指纹去重),本篇只做场景搭配。

先记一句总纲:**指纹只认你写下的配置**。跑起来才产生的值进不了指纹,指纹看不见的外部世界(agent CLI 版本、被测服务)也进不了——后者要重验用 [`--rerun all`](rerun.md)。

## 1. 改了一条 eval 的断言

**场景**:`evals/memory/recall-3.eval.ts` 里的断言写错了,改完想只重跑这一条。

```bash
$ pnpm exec niceeval exp compare/codex--nowledge
╭─ PLAN ──────────────────────────────────────────╮
│ 36 attempts · 36 evals × 1 configs              │
│ 35 of 36 carried in from cache · 1 to run       │
╰─────────────────────────────────────────────────╯
```

**你会看到**:指纹按**每条 eval** 各算一份,含该文件源码全文,所以改一个文件只作废那一条。同实验其余 35 条照常携带。这是缓存最常走的一条路径,不需要任何参数。

## 2. 改 `flags` 的值

**场景**:`flags: { webResearch: true }` 改成 `false`,想看关掉联网的通过率。

**你会看到**:该实验**全部** eval 重跑。这正是想要的——两个值下跑出来的是两批不同条件的结果,混在一起读通过率没有意义。要保住旧那批就别原地改:复制成第二个实验文件各钉一个值,两批结果各自成格、都留在结果树里,报告按 [`flag("webResearch")`](../../reports/library/metrics.md#维度与数值轴) 分组对比。

## 3. 改 `labels`、改实验文件的注释或格式

**场景**:补个报表坐标 `labels: { line: "codex" }`,或者格式化了一下实验文件。

**你会看到**:什么都不作废。`labels` 是纯报告坐标、不进指纹;实验文件本身也不进指纹(进指纹的是它**解析出来**的配置值),改注释、调整字段顺序、抽个变量都不影响携带。

## 4. 隧道 URL 每次重启就换一个

**场景**:记忆服务经 cloudflared quick tunnel 暴露,`setup` 里起隧道,每次重启拿到一个新 URL。跑批被打断,修好服务重跑,不想让已经跑完的 24 条重烧。

**不要写进 `flags`**——那是实验条件,整袋进指纹,换一次 URL 作废全部结果。它是跑起来才有的坐标:经工厂闭包给 agent / sandbox Hook 用,要留在记录里就上报成 fact:

```ts
// experiments/shared/nowledge.ts
sandboxSetup(): SandboxHook {
  return async (sandbox, ctx) => {
    ctx.fact("nowledge.endpoint", env!.url);        // 这条 attempt 实际连的实例
    await sandbox.writeFiles({ ".nowledge/env": `NMEM_URL=${env!.url}\n` });
  };
}
```

**你会看到**:换 URL 重跑,PLAN 头照常显示 `24 of 36 carried in from cache`。记录一样不少:每条 attempt 的 `facts` 里有它当时连的地址,`show` 的 `facts:` 行读得到,报告能按 `fact("nowledge.endpoint")` 分组;携带来的那条读到的仍是**产出它那一轮**的地址,不会被本轮的新 URL 冒名顶替。判据与三个家的分工见 [Library · 运行时坐标不进配置](../library.md#运行时坐标不进配置三个家)。

## 5. 这类坐标已经写在 `flags` 里了,现在要搬走

**场景**:实验一直是 `flags: { nowledgeEndpoint: process.env.NMEM_URL! }`,结果树里几轮历史都是按这个口径算的指纹。按上一条搬进 fact,`flags` 袋子就变了,历史一次性作废。

搬迁的那一次带上出口:

```bash
$ pnpm exec niceeval exp compare/codex--nowledge --carry-ignoring-flag nowledgeEndpoint
```

**你会看到**:携带判定按抹掉该键之后的 `flags` 认账,历史终态照常携入,搬迁不赔一轮重烧;本次 Run 记一条 `carry-ignoring-flag` diagnostic 留痕。**只作用于这一次调用**,下一次跑不需要也不该再带——那时值已经不在 `flags` 里了。键名可以重复给多个。

## 6. 提高或调低 `timeoutMs`

**场景**:上一轮有几条撞了 20 分钟的上限,想放宽到 40 分钟再跑。

**你会看到**:提高上限**不作废任何东西**——超时上限不改变「结果是什么」,只决定「等不等得到」,它不进指纹;已完成的照常携带,只有当初撞线的 `errored`(本就永不携带)重跑。反过来调低上限时,`durationMs` 超过新线的旧终态在新配置下复现不出来,如实重跑。

**改之前先看清楚现在这个上限是哪一层给的**:它由 `--timeout` → experiment → eval → config 解析而来(链见 [Resolved config](../architecture.md#resolved-config一次求值处处同源)),超时报错里的 `from …` 直接写着答案。改错层的症状是「改了没生效」——experiment 里钉了 20 分钟时,去 config 上调到 40 分钟不会有任何变化。

## 7. `attempts` 从 3 提到 5

**你会看到**:不作废。携带以 attempt 为粒度,已有的 3 条终态携入,本次只跑缺的 2 条,通过率的分母由两者凑满。同理,`attempts` 调小不会删掉已有结果。

## 8. 换沙箱模板 / 镜像,或改 sandbox Hook

**场景一**:`e2bSandbox({ template: "niceeval-agents" })` 换成另一个 template。**你会看到**:该实验全部重跑——provider 与预制产物参数进指纹,起步环境变了结果就不可比。

**场景二**:template 没变,但改了 sandbox spec 的 `.setup()` Hook(多装一个二进制),或者重建了同名镜像。**你会看到**:什么都不作废——Hook 函数体与镜像内容都不在指纹里。这是有意的:Hook 是环境预置代码,常改且大多不影响结果。确实变了行为、要全量重验时用 [`--rerun all`](rerun.md)。

## 9. agent CLI 升级了,被测服务改了行为

**你会看到**:不作废,携带照旧。指纹算的是你写下的配置,外部世界不在里面——旧的「绿」这时可能掩盖真实回归。定期或换版本后用 [`--rerun all`](rerun.md) 全量重验一次;能配置化的差异(服务端版本号)就显式写进 `flags`,让指纹自然失效,比每次手动 `--rerun all` 可靠。

## 10. 改了 agent 工厂的参数,却没重跑

**场景**:`codexAgent({ webSearch: true })` 改成 `false`,PLAN 头显示全部携带。

**这是配置放错了位置**:指纹只认 agent 的**名字**,工厂内部参数它看不见。开关归实验声明、adapter 从 `ctx.flags` 读,是 [配置归属不变量](../../adapters/architecture/agent-contract.md#配置归属不变量)本来就要求的写法:

```ts
export default defineExperiment({
  agent: codexAgent(),                // agent 定义里不写死开关
  flags: { webResearch: false },      // 改这里才会作废、才会被报告分组读到
});
```

**你会看到**:值一变该实验就全量重跑(第 2 条),报告也能按 `flag("webResearch")` 把两批结果排到同一根轴上。

## 11. 就是想重跑,但指纹没得改

**场景**:怀疑缓存口径本身、或要在发布前全量复验一遍。

```bash
$ pnpm exec niceeval exp compare/ --rerun all
```

**你会看到**:忽略全部可复用结果,选中的矩阵完整重跑一遍;想只重烧一部分就用位置参数收窄选择。`--rerun all` 是一次性开关,不改指纹定义,下次不带它照常携带。完整用例见 [`--rerun all`](rerun.md)。

## 相关阅读

- [Runner · 缓存:指纹去重](../../../runner.md#缓存指纹去重) —— 指纹输入清单、携带粒度与终态定义的单源。
- [flags / labels / facts 放哪个](flags-labels-facts.md) —— 一个值该写进哪个家。
- [`--rerun all`:指纹未变但外部世界变了,全量重验](rerun.md)
