# 并发怎么配:用例手册

按场景查表:找到最像你的用例,照抄搭配。每个用例回答三件事——什么场景、配什么、配完你会看到什么行为。调度语义的单点定义在 [Runner · 调度](../../../runner.md#调度有界并发),本篇不重复机制,只给搭配。

| 你的场景 | 搭配 | 用例 |
| --- | --- | --- |
| eval 互相独立,想跑得快 | 什么都不配 | [1](#1-互相独立的-eval什么都不配) |
| 跨 eval 累积状态,状态是宿主机上的文件 | 沙箱钩子 + `maxConcurrency: 1` | [2](#2-跨-eval-累积记忆状态在宿主机文件里) |
| 跨 eval 累积状态,状态在一个中心服务里 | 实验级 setup/teardown + `maxConcurrency: 1` | [3](#3-跨-eval-累积记忆状态在中心服务里) |
| agent 老撞 429,只想给这个实验降速 | `maxConcurrency: N` | [4](#4-agent-老撞限额给这个实验单独降速) |
| agent 限额按用户计并发 run 数,重试一直撞 | `maxConcurrency: N` | [4](#4-agent-老撞限额给这个实验单独降速) |
| 想要「过了就停,没过才跑下一次」 | `runs` + `earlyExit` + `maxConcurrency: 1` | [5](#5-严格重试过了就停没过才跑下一次) |
| 沙箱钩子要共享状态,但不想牺牲并发 | `WeakMap` 按 sandbox 存取 | [6](#6-并发下钩子共享状态不想串行) |
| 在本机工作树上跑(`localSandbox`) | 什么都不配,天然串行 | [7](#7-本地工作树天然串行不用配) |
| 整体太慢 / 整体撞限流 | `--max-concurrency` | [8](#8-全局吞吐--max-concurrency-什么时候调) |
| 快慢实验想混在一次命令里跑 | 什么都不配,直接混 | [9](#9-快慢实验混跑什么都不配) |

## 1. 互相独立的 eval:什么都不配

**场景**:最常见的对照实验——每条 eval 自带干净沙箱,attempt 之间不共享任何东西。

```ts
export default defineExperiment({
  agent: claudeCode({ model: "claude-sonnet-5" }),
  evals: "*",
  sandbox: dockerSandbox(),
  // 没有 maxConcurrency:并发上限由全局解析(--max-concurrency → config → provider 推荐值)
});
```

**你会看到**:attempt 按全局并发上限齐头并进。不要照抄别的实验里的 `maxConcurrency: 1`——那是共享状态实验的正确性声明,抄过来只会把这一个实验拖成串行。

## 2. 跨 eval 累积记忆:状态在宿主机文件里

**场景**:测「记忆机制有没有用」——每个 attempt 开始时把宿主机上的记忆文件载入沙箱,结束时把沙箱里更新过的记忆回存宿主机,下一条 eval 带着上一条的记忆继续。

```ts
export default defineExperiment({
  agent: claudeCode({ model: "claude-sonnet-5" }),
  evals: ["memory/"],
  maxConcurrency: 1,                    // 载入…回存是临界区:一次只放一个 attempt
  sandbox: dockerSandbox()
    .setup(async (sandbox, ctx) => {    // attempt 开始:载入
      await loadMemoryState(sandbox, ctx.experimentId);
    })
    .teardown(async (sandbox, ctx) => { // attempt 结束:回存
      await saveMemoryState(sandbox, ctx.experimentId);
    }),
});
```

**你会看到**:attempt 严格一个接一个跑(按 eval 顺序)。上一个 attempt 的回存钩子没跑完、沙箱没销毁,下一个 attempt 的沙箱不会创建——即使上一个 attempt 撞了限流、正在退避睡眠,下一个也不会趁机进场。所以钩子里**不需要自己加锁**,`maxConcurrency: 1` 这一行就是全部的正确性声明。

钩子的完整写法(状态文件路径、tmp+rename 原子回存)见 [Sandbox · 沙箱生命周期钩子](../../sandbox/library.md#沙箱生命周期钩子setup-teardown)。

## 3. 跨 eval 累积记忆:状态在中心服务里

**场景**:记忆不落文件,存在一个服务端(整场起一次隧道/服务),每个 attempt 通过它读写记忆。累积顺序仍然要求 attempt 串行。

```ts
let tunnel: { url: string; apiKey: string; stop(): Promise<void> };

export default defineExperiment({
  agent: nowledgeAgent(() => ({ url: tunnel.url, apiKey: tunnel.apiKey })),
  evals: ["memory/"],
  maxConcurrency: 1,                    // 服务端记忆按 attempt 顺序累积
  sandbox: e2bSandbox({ template: "niceeval-agents" })
    .setup(async (sandbox) => {         // 每沙箱一次:把服务坐标写进沙箱
      await sandbox.writeFiles({
        ".nowledge/config.json": JSON.stringify({ url: tunnel.url, apiKey: tunnel.apiKey }),
      });
    }),
  async setup(ctx) {                    // 整场一次,宿主机侧
    tunnel = await nowledgeTunnel({ signal: ctx.signal });
  },
  async teardown() {
    await tunnel?.stop();
  },
});
```

**你会看到**:实验级 `setup` 整场只跑一次(第一个 attempt 派发前);attempt 一个接一个跑,服务端看到的读写顺序与 eval 顺序一致。完整版本(含状态回存对照)见 [Library · 实验级共享服务](../library.md#实验级共享服务setup-与-teardown)。

## 4. agent 老撞限额:给这个实验单独降速

**场景**:agent API 限额低(或它的 provider 容易 429),想压这个实验、不拖慢同批其它实验。**限额是按用户计「同时在跑的 run 数」的并发型时,即使一次命令只跑这一个实验,也用这里的实验级闸而不是全局 flag**——全局位退避让位、对外压力不降,分界见[用例 8](#8-全局吞吐--max-concurrency-什么时候调)。

```ts
export default defineExperiment({
  agent: codex({ model: "gpt-5.4" }),
  evals: "*",
  maxConcurrency: 3,   // 只压本实验:同一时刻最多 3 个 attempt
  sandbox: e2bSandbox(),
});
```

**你会看到**:本实验最多 3 个 attempt 在飞,同批其它实验照常按全局并发跑。撞了限流进退避的 attempt 会把**全局**名额让给别的实验,但**不会**向本实验放行第 4 个 attempt——被限流时不加压,正是降速要的效果。注意实验级闸和全局位都是**每条 Invocation 自己的**:开多个终端并行跑([用例锁](../architecture.md#并发-invocation用例锁)保证不双跑)时,agent 侧限额承受的是各进程之和,每个终端各自把这里的 N 调低。

## 5. 严格重试:过了就停,没过才跑下一次

**场景**:每条 eval 给多次机会,但希望「先跑一次,过了就省掉剩下的,没过才跑下一次」,而不是多次机会一起并发烧钱。

```ts
export default defineExperiment({
  agent: claudeCode({ model: "claude-sonnet-5" }),
  evals: "*",
  runs: 3,
  earlyExit: true,
  maxConcurrency: 1,   // 名额只有一张,同 eval 的 attempt 被挤成一个接一个
  sandbox: dockerSandbox(),
});
```

**你会看到**:每条 eval 先跑第 1 次;`passed` 则第 2、3 次直接省掉,没过才派发下一次。不配 `maxConcurrency: 1` 时 `runs: 3` 会一起派发,earlyExit 只能省掉还没开跑的那部分。细节见 [Runner · 首过即停](../../../runner.md#首过即停earlyexit),`--early-exit` flag 的全流程见[输入面用例](early-exit.md)。

## 6. 并发下钩子共享状态,不想串行

**场景**:沙箱钩子的 `setup`/`teardown` 之间要传值(比如 setup 里记下起始时间、teardown 里算耗时),但 attempt 之间互不依赖,不想为了传值把实验压成串行。

```ts
const startedAt = new WeakMap<object, number>();

const sandbox = dockerSandbox()
  .setup(async (sb) => {
    startedAt.set(sb, Date.now());        // 以 sandbox 实例为键:并发 attempt 互不覆写
  })
  .teardown(async (sb) => {
    report(Date.now() - startedAt.get(sb)!);
  });
```

**你会看到**:并发照常,值不串线。普通模块变量在并发下会被别的 attempt 覆写——要么像这样按 sandbox 实例存取,要么(确实需要跨 attempt 累积时)回到用例 2 的 `maxConcurrency: 1`。

## 7. 本地工作树:天然串行,不用配

**场景**:用 `localSandbox()` 直接在本机工作树上跑。

**搭配**:什么都不配。`local` provider 自己声明了独占串行(一棵工作树只能一个 attempt 用),runner 强制一个一个跑,`--max-concurrency` 和实验级 `maxConcurrency` 都解除不了。

**你会看到**:attempt 恒串行;把 `--max-concurrency` 开大只会得到一条 warning,不会并发。

## 8. 全局吞吐:`--max-concurrency` 什么时候调

**场景**:整体太慢想开大,或整体撞限流想压小——影响这次命令里的**所有**实验。

```bash
niceeval exp --max-concurrency 20   # provider 扛得住、agent API 限额高时开大
niceeval exp --max-concurrency 2    # agent API 限额低时整体压小
```

**你会看到**:不传时默认值来自沙箱 provider 的推荐(`docker` 10、`e2b` 20、`vercel` 1、`local` 1)——它反映 provider 侧容量,不是你的 agent API 限额。压 agent 限额前先分清限额类型:**速率型**(按时间窗计请求数)开小这个 flag 就有效——在飞请求变少,窗口内请求数跟着降;**并发型**(按用户计同时在跑的 run 数)贴线配置(flag 值 = 限额值)压不稳——退避让出的全局位立刻派给新 attempt,agent 侧并发恒顶在上限,睡醒的重试面对的仍是打满的限额。并发型要么把值设到限额以下留余量,要么回到用例 4 用实验级闸(退避不释放,被限流时真正不加压)。只有一个实验超限额时,别用全局 flag,回到用例 4。撞限流时面板 `running` 会超过上限(退避睡眠者计 running 但不持位),读法与降档重跑的全流程见 [`--max-concurrency` 输入面用例](max-concurrency.md)。

## 9. 快慢实验混跑:什么都不配

**场景**:一个串行的记忆实验(用例 2,几十条 eval 要跑很久)和几个全速的基线实验,想一次命令跑完。

**搭配**:直接混在一次命令里,不用为慢实验单开一次运行,也不用手动排先后。

**你会看到**:并发名额优先喂给要跑最多轮的瓶颈实验(串行那个),快实验见缝插针补空位;有慢 `setup`(起隧道)的实验在等 `setup` 时不占名额。总墙钟时间接近瓶颈实验自己的串行耗时,而不是各实验耗时相加。
