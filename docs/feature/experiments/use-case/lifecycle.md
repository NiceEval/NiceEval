# 环境预置与收尾怎么放:用例手册

四层生命周期(experiment / sandbox / agent / eval)+ 外部编排,规则只有一句:**随什么变化、活在哪一侧,就放进哪一层**。分工表的单点在 [Sandbox · 环境预置放哪](../../sandbox/library.md#环境预置放哪),本篇按场景给搭配。

| 你要准备的东西 | 放哪 | 用例 |
| --- | --- | --- |
| 所有 attempt 都一样的重依赖(系统包、CLI 二进制) | provider 的 image/template | [1](#1-重依赖烘进镜像不写-setup) |
| 这条 eval 自己的起始文件 / 装依赖 | `EvalDef.setup` / `test(t)` | [2](#2-这条题目自己的任务-fixture) |
| 按实验变的沙箱内小预置(hook 文件、预检) | `sandbox.setup()` 链式 Hook | [3](#3-按实验变的沙箱内预置) |
| 整场一份的宿主机服务(隧道、mock server) | `ExperimentDef.setup` / `teardown` | [4](#4-整场一次的共享服务) |
| 跨 attempt 载入/回存状态 | 沙箱 Hook 对 + 串行 | [并发手册 · 用例 2](concurrency.md#2-跨-eval-累积记忆状态在宿主机文件里) |
| 跨实验、run 之前就该存在的服务 | 外部编排(compose / CI 脚本) | [5](#5-run-之外的长命资源外部编排) |

## 1. 重依赖:烘进镜像,不写 setup

**场景**:每个沙箱都要 python3 + poppler + 一堆 pip 包,`setup` 里装一遍要 3 分钟。

**搭配**:进 provider 的预制产物,spec 只引用:

```ts
sandbox: e2bSandbox({ template: "niceeval-agents" })   // 依赖在模板构建时装好
```

**你会看到**:`sandbox.create` 秒起,面板上不再有长时间停在 `sandbox setup` 的行。判据:所有实验、所有 eval 都要的东西,一律不进任何 `setup`——那是每个 attempt 重复付一次的钱。

## 2. 这条题目自己的任务 Fixture

**场景**:某条 eval 需要一个预置了失败测试的项目作为起点,别的 eval 不需要。

```ts
export default defineEval({
  description: "agent 能修复失败的单测",
  async setup(sandbox) {
    await sandbox.runCommand("npm", ["install"]);      // 只为这条题装
  },
  async test(t) {
    await t.run("修复 test/checkout.test.ts 里失败的用例");
    await t.command("npm test").succeeds();
  },
});
```

**你会看到**:面板该 attempt 停在 `eval setup` 直到装完;这些改动打进 git 基线,**不会**被算成 agent 的 diff。跑到这条 eval 的每个实验都会执行它——对实验中立的题目材料才放这里。

## 3. 按实验变的沙箱内预置

**场景**:只有这个实验要往沙箱里写一个 hook 文件(比如给 agent 注入内存监控),对照组实验不写。

```ts
export default defineExperiment({
  agent: claudeCode({ model: "claude-sonnet-5" }),
  evals: "*",
  sandbox: dockerSandbox()
    .setup(async (sandbox) => {
      await sandbox.writeFiles({ ".hooks/pre-run.sh": HOOK_SCRIPT });  // 每沙箱一次
    }),
});
```

**你会看到**:Hook 在沙箱创建后、git 基线锚点前跑——写入的文件进基线,不污染 agent diff。清理不用管:沙箱内文件随销毁自动消失;只有写到**沙箱外**的东西才需要配对的 `.teardown()` 显式回收。

## 4. 整场一次的共享服务

**场景**:实验要连一个内网服务,得先起隧道;几十个 attempt 共用同一条,拆一次就好。

```ts
let tunnel: { url: string; stop(): Promise<void> };

export default defineExperiment({
  agent: myAgent(() => ({ url: tunnel.url })),   // 闭包读,runner 不做值的中介
  evals: "*",
  sandbox: dockerSandbox(),
  async setup(ctx) {
    tunnel = await openTunnel({ signal: ctx.signal });  // 宿主机侧,整场一次
  },
  async teardown() {
    await tunnel?.stop();                               // 全部 attempt 收尾后必跑(中断也跑)
  },
});
```

**你会看到**:第一个 attempt 派发前面板出现一行 `experiment setup · <实验 id>`,期间其它 attempt 计入 `queued`(不是卡死);`setup` 抛错时本实验每条 attempt 记 `errored`(code `experiment-setup-failed`),同批其它实验照常跑。`teardown` 里把资源释放包进 `try/finally`,观测类动作失败不拦释放。

## 5. run 之外的长命资源:外部编排

**场景**:几个实验都要连同一个共享数据库,而且它在这次 run 之前就该活着。

**搭配**:不进任何一层 setup——外部编排:

```bash
docker compose up -d && niceeval exp compare; docker compose down
```

URL 经 env 传给 agent / eval。**判据**:生命周期比一次 `niceeval exp` 长的资源,niceeval 不该负责它的生死。

## 常见错位

- 把镜像级依赖写进 `sandbox.setup()` → 每个 attempt 重复装,面板长时间停在 `sandbox setup`。回用例 1。
- 把「只有这个实验要」的预置写进 `EvalDef.setup` → 对照组实验也被注入,对比失效。回用例 3。
- 在 `ExperimentDef.setup` 里往沙箱写文件 → 它跑在宿主机、此刻一个沙箱都不存在。沙箱内的事进用例 3 的 Hook。
- `teardown` 想用 `setup` 的产物时找 runner 要 → 不存在这个通道,状态走闭包(用例 4);并发下每沙箱一份的状态用 `WeakMap` 以 sandbox 实例为键(见[并发手册 · 用例 6](concurrency.md#6-并发下-hook-共享状态不想串行))。
