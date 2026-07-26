# `--reuse-sandbox`:怎么写 eval 才能安全进热道

## 解决什么问题

`--reuse-sandbox` 不检测你的 eval 写法。它不加任何「这个 setup 是不是偷看了某条
eval」的探测,只按[温基线分层](../serial-reuse.md#温基线一次装好后续只重置到这里)
把不随 eval 变的层装一次、每题只重放 Fixture(裁决理由见[串行复用](../serial-reuse.md#温基线一次装好后续只重置到这里))。

因此准入条件不是「生命周期满足某个条件才允许开复用」,而是**放错层的代价在复用档下
被放大**:默认模式下一次放错最多污染这一个 attempt 或对照组,复用档下它落在温基线
之下,泄漏给这一批后面的每一题。本篇按场景给写法,机器判的硬门(同基线批次、
与并发 / 留存 / 本地档的互斥)在[另外三篇](README.md#--reuse-sandbox串行复用)。

四层生命周期各自管什么的单点在
[环境预置与收尾怎么放](../../experiments/use-case/lifecycle.md);本篇只讲这些规则在
热道上多出来的后果。

## 1. 随 eval 变的准备只放 `EvalDef.setup` / `test(t)`

**场景**:某条 eval 需要一个装好依赖、预置了失败测试的项目做起点。

```ts
export default defineEval({
  async setup(sandbox) {
    await sandbox.runCommand("npm", ["install"]);   // 每题重放,落在温基线之上
  },
  async test(t) {
    await t.sandbox.writeFiles({ "test/checkout.test.ts": BROKEN });
    await t.send("修复 test/checkout.test.ts 里失败的用例");
  },
});
```

**你会看到**:热道上每题先 reset 回温基线,再重放这两处写入,send 窗口与默认模式
逐字相同。

**放错的样子**:同一段 `writeFiles` 写进 `sandbox.setup()` 链,它就跑在温基线**之前**
——第一题看起来对,第二题开始每题都带着上一批的素材,而且题间 `git reset` 抹不掉它。
判据是一句话:这段准备换一条 eval 还成立吗?不成立就不属于沙箱层。

## 2. 副作用留在 workdir 内,且不落在分类账排除清单里

**场景**:eval 的验证步骤要装一个 CLI 工具才能跑。

题间重置的精确操作是 `git reset --hard` 回到温基线,加一次尊重
[分类账排除清单](../architecture.md#变更归因send-窗口与分类账)的 `git clean`。
活过重置的东西按下表分两类:

| 你写的位置 | 题间重置后 |
|---|---|
| workdir 内、被分类账跟踪的文件 | 回到温基线状态 |
| `node_modules` / venv / 构建产物 / 包管理器 cache | 留着(排除清单里,刻意不清) |
| `$HOME`、`/tmp`、全局 `npm install -g` 的包 | 留着 |
| 进程级环境变量、agent CLI 自己的 cache | 留着 |

所以工具装进 workdir 内的项目依赖(`npm install` 到 `node_modules`)在热道上留着是
想要的效果——不重装才谈得上省冷启动;装成全局包则会跨题泄漏,单独跑和串起来跑可能
给出不同判定。

**判据**:这条 eval 跑完之后,沙箱里有哪些变化是 `git reset` 管不到的?每一处都是
一个潜在的跨题泄漏点。

## 3. 起了后台进程或占了端口,自己在 `EvalDef.teardown` 收掉

**场景**:eval 起一个 dev server,让 agent 对着它调试。

```ts
export default defineEval({
  async setup(sandbox) {
    await sandbox.runShell("npm run dev > /tmp/dev.log 2>&1 &");
  },
  async teardown(sandbox) {
    await sandbox.runShell("pkill -f 'npm run dev' || true");   // reset 不杀进程
  },
});
```

**你会看到**:每题拿到的是一个没有残留监听的沙箱。漏了 `teardown` 时,下一题的
`npm run dev` 撞在已占用的端口上,报错落在与写法很远的地方——一条挂在「端口被占」
上的 eval,单独跑永远是绿的。

## 4. adapter 的 `setup` 不读当前是哪条 eval

复用把 `SandboxAgent.setup` 提到温基线**之前**(相对默认链的一次重排,契约见
[温基线分层](../serial-reuse.md#温基线一次装好后续只重置到这里))。这个提前的合法性
来自[配置归属不变量](../../adapters/architecture/agent-contract.md#配置归属不变量):
MCP、skills、model、主配置都从 adapter factory 与 experiment 进,不从「当前是哪条
eval」进。

**放错的样子**:adapter 在 `setup` 里按 eval id 分支写不同的 agent 配置。它违反的是
那条不变量,复用只是让后果显形——第一题的配置被整批共用。修法是把按 eval 变的部分
搬进 `EvalDef.setup` / `test(t)`,不是给复用加检测。

## 5. 断言不依赖「这是一个全新沙箱」

**场景**:eval 断言 agent 创建了某个文件,写法是「跑完之后这个路径存在」。

热道上这类断言可能被上一题的残留喂成假阳性:上一题在 `$HOME` 或排除路径下留过同名
产物,这一题不做任何事也过。写成读 agent 归因增量的形式
(`t.sandbox.fileChanged` / `t.sandbox.diff`)就不受影响——send 窗口按温基线锚点算,
和默认模式一样。

**同类不适合热道的断言**:某端口空闲、某全局包未安装、`$HOME` 下没有某配置。这几种
的前提就是全新实例,要验它们用默认模式。

## 边界

- 本篇的规则在默认模式下同样正确,只是那里放错的代价小、不容易被发现;复用档不是
  额外一套写法,是同一套规则的放大镜。
- 即使五条全部照做,复用运行的结果仍然只是本地信号:workdir 之外一律不重置是模式的
  明码标价([诚实边界](../serial-reuse.md#诚实边界git-reset-只清-workdir)),
  这些 attempt 也永不被后续 run 的指纹当命中。要出可采信的结论,去掉 flag 再跑。

## 相关阅读

- [串行复用](../serial-reuse.md) —— 温基线分层、诚实边界、不设检测的裁决。
- [环境预置与收尾怎么放](../../experiments/use-case/lifecycle.md) —— 四层生命周期的
  分工与常见错位。
- [Agent 契约](../../adapters/architecture/agent-contract.md#生命周期不变量) ——
  agent 级 setup / teardown 的不变量。
- [本地冒烟一批 eval](reuse-sandbox-batch-smoke.md) —— 照着这些规则写完之后的完整
  运行路径。
