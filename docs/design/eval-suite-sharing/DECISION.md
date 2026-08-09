# 决策

**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3（未采用）](PLAN-3/README.md) · [Feature 契约](../../feature/eval/sharing.md)

## 裁决

采纳文件级 `defineRemoteEval`：消费项目在独立 Eval 文件中显式引用已安装 package 中的一道 Eval。

`defineEval` 与 `defineRemoteEval` 是并列的文件级入口。
前者定义消费项目拥有的题，后者在消费项目拥有的文件路径上建立一条惰性远程引用。
远程文件路径决定项目内 Eval id，Experiment 继续使用既有 `evals` selector。

`defineRemoteEval` 只接受 `package`、`root` 与 `eval`。
它不接受 id、patch、override、tags、Sandbox 或运行配置字段；这些字段会模糊消费方与上游的所有权边界。

NiceEval 在被选择的远程 Eval 运行前验证：直接 dependency、package manager lock、实际安装路径、package owner 边界和 source identity。
验证成功后才导入上游 Eval，并把上游的 NiceEval import 绑定到消费项目的 canonical runtime。

package manager 仍是版本和安装选择的唯一 owner。
NiceEval 保存去凭据的 provenance，不安装、升级或改写 lockfile，也不新增 `eval.lock`。

## PLAN-3 的处置

[PLAN-3](PLAN-3/README.md) 的 `Config.evalRoots` 方案会扫描 package 内的 root，并自动把整棵目录加入 catalog。
该行为被否决，不能作为公开 API 或实现目标。

文件级方案保留 PLAN-3 的 package-manager 路径定位、安装身份验证、owner containment、canonical runtime 与 provenance 原则。
它删除配置挂载、外部根自动发现和由安装内容自动扩张 catalog 的行为。

已安装 package 只有被某个 `defineRemoteEval` 文件引用时才可见。
未来可以另行设计只读 inspect 命令来检查 package；该命令不属于这份共享契约，也不能恢复自动发现。

## 携带裁决

初始契约以 package identity 作为远程 Eval 集合的携带边界。
package identity 改变后，引用该 package 的全部远程 Eval 都失去携带资格，即使其中一条上游 source 看起来没有变化。

Record 继续区分 definition origin 与 execution origin。
因此历史结果仍能说明实际执行的 package identity，不会被新的定义 provenance 改写。

逐 Eval 的跨 package 版本 source、dependency、runtime 与 transfer 对比延期到独立设计。
初始契约不提供用 `accept` 或其它 override 绕过 package identity 变化的路径。

## 为什么不是 PLAN-1

PLAN-1 在运行语义上没有缺口，但它把每次消费变成一次 fork。
Terminal-Bench 这类数百题题集会在每个项目复制完整资产树，后续修正没有可重复的升级边界。

显式引用依赖仍让安装后的文件对编辑器、类型系统与 NiceEval 源码捕获可见。
区别在于发布方继续拥有内容，消费方在 Git 中明确选择要纳入的题和接收上游变化的时点。

## 为什么不是 PLAN-2

PLAN-2 照搬 Harbor 的归档分发，却忽略 NiceEval Eval 是 TypeScript project dependency 的事实。
外部 Eval 的项目内模块和 package 依赖仍要由 JavaScript package manager 安装，专用 registry 无法替代这一步。

两份 lock 会让完整依赖图没有单一 owner。
NiceEval registry 若只锁外层归档就不完整，若接管传递依赖就等于重写 npm、pnpm 与 Yarn。

## 为什么不是 PLAN-3

自动扫描外部根把「package 已安装」隐式解释成「项目应拥有 package 内的所有题」。
这会在依赖升级时改变 catalog，也让 code review 看不到消费者实际选择了哪一道题。

显式远程 Eval 文件把选择、项目 id 和审查边界放回消费项目的普通文件树。
它保持 Experiment 的单一选择模型，同时不把 package 安装变成一次隐式题集导入。

## 结果边界

共享 Eval 继续产生普通 Record，不增加外部题专用结果格式。
远程引用只补充 definition origin、execution origin 和携带资格所需的 package identity 事实。
