# 决策

**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md)

## 裁决

采纳 [PLAN-3](PLAN-3/README.md)：消费项目挂载另一个已安装 NiceEval 项目的 Eval 目录。

发布方不写 `defineEvalSuite()`、`suite.ts`、manifest 或专用 package export。
它只维护原本就能运行的 NiceEval 项目，并通过普通 package、Git dependency、tarball 或 workspace 交付现有文件。

NiceEval 增加六件事：

1. `defineConfig({ evalRoots })` 用 package、root 与挂载 key 引用外部 Eval 根。
2. 发现器合并本地与外部根，并把 owner root capability 贯穿 loader、源码、Sandbox 与 transfer 路径。
3. Node >=22.15 的同步模块查找 hook 把外部 owner 内 NiceEval import 绑定消费运行时，保证原生定义只有一个契约实例。
4. 真实模块 DAG 把共享运行期模块的源码、loader、criteria 与 private 事实投影到每条 Eval。
5. fingerprint 投影逐 Eval 可达 dependency、NiceEval runtime revision 与可重验 transfer manifest。
6. CLI 和 Record 显示精确 installed identity，并区分 definition origin 与 execution origin；不负责安装或升级依赖。

不新增 `eval.lock`。
项目 package lock 固定外部 Eval 与依赖选择，NiceEval fingerprint 和 manifest 只读投影逐 Eval 身份与携带。

在 loader、owner capability、dependency projection 与 transfer manifest 四个正确性前置项完成并通过安装矩阵前，不批准只实现“多扫描一个目录”的缩水版本。

## 为什么不是 PLAN-1

PLAN-1 在运行语义上没有缺口，但它把每次消费变成一次 fork。
Terminal-Bench 这类数百题题集会在每个项目复制完整资产树，后续修正没有可重复的升级边界。

挂载依赖仍让安装后的文件对编辑器、类型系统与 NiceEval 源码捕获可见。
区别在于发布方继续拥有内容，消费方通过依赖升级明确选择何时接收变化。

## 为什么不是 PLAN-2

PLAN-2 照搬 Harbor 的归档分发，却忽略 NiceEval Eval 是 TypeScript project dependency 的事实。
外部 Eval 的项目内模块和 package 依赖仍要由 JavaScript package manager 安装，专用 registry 无法替代这一步。

两份 lock 会让完整依赖图没有单一 owner。
NiceEval registry 若只锁外层归档就不完整，若接管传递依赖就等于重写 npm、pnpm 与 Yarn。

## 为什么不要求发布入口

NiceEval 已有稳定的项目约定：`evals/` 是发现根，文件路径形成 id，Eval 模块默认导出原生 Definition。
再写一个只重复 package identity 与目录位置的发布定义，不会增加运行信息，只会制造同步点。

挂载位置是消费项目的决定，所以它应在消费配置中声明。
package name、version、repository 与 license 可从现有 `package.json` 取得；逐题身份来自现有源码捕获。

## 精确失效的裁决

Package lock 按 package 固定安装内容，但不决定结果是否携带。
NiceEval 对挂载后的每条 Eval 分别捕获源码闭包、可达 dependency、runtime revision、Sandbox 与 transfer 输入。

依赖升级时：

- 单题源码、Fixture、判据或 Sandbox 输入改变，只作废受影响 Eval。
- 一个项目内模块改变，只作废静态 import 它的 Eval。
- 一个 bare dependency 改变，只作废可达它的 Eval。
- `test(t)` 上传的判据内容改变，作废引用历史 transfer manifest 的 Eval。
- 与 Eval 闭包无关的文件改变，不作废结果。
- 挂载前缀改变会改变 Eval id，因此形成新的项目内结果身份。

动态依赖或运行期路径无法在计划期完整重验时保守重跑。
Terminal-Bench 10 条带随机 Compose env 的题也采用这一正确性优先裁决；零发布改造保证能运行，不保证它们跨进程携带。

## 结果边界

共享契约止于 Eval 与它的运行输入。
共享 Eval 继续产生普通 Record，不增加外部题专用结果格式。

## 可演进边界

公开目录未来可以索引包含原生 NiceEval Eval 的 package 或仓库。
目录只负责发现，不参与安装、版本选择或 lockfile 写入，也不要求发布方增加共享 manifest。

若未来出现不含可执行 TypeScript 的语言中立任务协议，应另开设计比较 registry。
该问题不能反向扩大原生 Eval 共享的第一版边界。
