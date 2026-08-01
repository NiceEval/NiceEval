# PLAN-7:唯一 Environment 起点与普通文件传输(被 PLAN-8 取代)

**相关文档**:[决策主题](../README.md) · [GOALS](../GOALS.md) · [CASES](../CASES.md) · [LIMITS](../LIMITS.md)

**方案正文**:[Library](library.md) · [Architecture](architecture.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md)

---

## 结论

每条 Attempt 仍只解析一个 Sandbox Case。
SandboxSpec setup、EvalDef setup 与 Agent setup 仍按各自 owner 准备同一个 Sandbox。

PLAN-7 不再为 Terminal-Bench 增加文件专用 Eval API。
题目在 `test(t)` 中按普通 TypeScript 顺序调用 `t.send()`、`t.sandbox.upload*()`、`runShell()` 与断言；先后顺序就是可见性。

## 作者心智

每道 Eval 是一份自包含定义。
作者只回答四个问题:

| 问题 | 写在哪里 |
|---|---|
| 从什么环境启动 | `environment` |
| Agent 要完成什么 | `await t.send(...)` |
| 什么时候把文件放进 Sandbox | 对应位置的普通 `t.sandbox.upload*()` |
| 怎样观察和断言 | 紧随其后的普通命令、读取与 `t.check()` |

第一次 `send` 前上传的文件会被 Agent 看见；某次 `send` 返回后上传的文件不会被过去的 turn 看见；若作者随后再次 `send`，新 turn 能看见此前上传的文件。
这就是普通顺序执行，不需要 `fixture.files`、`criteria`、`privateFiles`、`verifier` 或 `afterAgent` 状态机。

## 为什么不设文件 field

文件是 Fixture、隐藏测试、baseline 还是最终产物，不是文件自身的类型。
同一个文件在不同 Eval 中可能承担不同用途；框架不应把普通传输复制成多套 API。

`loadCriteria`、`criteria` 与 `privateFiles` 都是为了让 Runner 提前取得指纹和泄题信息，却把内部缓存实现推给作者。
`afterAgent` 又试图禁止 callback 后继续发 turn，但普通 TypeScript 顺序已经完整表达了真实可见性。

PLAN-7 采用一条更中立的规则：本地路径或 URL 进入普通上传 API 时，Runner 自动记录这次外部文件读取及其内容身份。

## 身份与泄漏的诚实边界

动态文件依赖在普通代码执行时才完全确定，框架不能在不运行任意 TypeScript 的情况下静态预知它们。
因此:

1. 首次执行真实运行并产生 transfer manifest；
2. 后续携带在派发前重算上一份 manifest 的文件身份；
3. Eval 源码闭包变化时不信任旧 manifest，直接重跑；
4. materializer 记录 Agent 可见的 build/mount closure；
5. 判定封口前，把本次 `send` 窗口外上传的本地 source 与该 closure 比对，命中则结果无效。

首次执行的事后比对保证判定不会采信泄题环境，但不能倒流阻止已经发生的暴露。
需要保密而不仅是保证评测有效性时，测试材料必须物理放在 build context 外，或由 materializer 在启动前提供 filtered context。

## 模块求值保持纯声明

Eval 模块顶层只构造定义。
运行期 nonce、Compose project/container 名、宿主临时目录与日志收集属于 Sandbox materializer，不允许每题在 `defineEval()` 外用 `randomBytes()` 或 `mkdirSync()` 准备。

## 不抽走每题定义

PLAN-7 不新增 Terminal-Bench Eval 工厂。
每题不同的 instruction、tags、timeout、Environment、上传目标与跑测命令继续在各自文件中完整可见。

## 落地路线

1. 保持 Environment 与三层 setup owner。
2. 删除 `loadCriteria`、`loadPrivate`、`fixture.files`、`criteria`、`privateFiles`、`verifier` 与 `afterAgent` 候选面。
3. 普通 `uploadFile` / `uploadDirectory` 接受 Eval 模块相对 `URL`，并记录 source tree、内容摘要、调用区间与 Sandbox 目标。
4. carry planner 读取上次 transfer manifest；源码或依赖变化时重跑。
5. materializer 记录 Agent 可见 closure，判定封口前执行动态泄漏比对。
6. agent diff 继续只认 `send` 窗口；窗口外上传与跑测不需要 `diff.ignore`。
