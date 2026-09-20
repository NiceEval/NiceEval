# Lifecycle：外部项目、消费与升级

**相关文档**：[README](README.md) · [Library](library.md) · [CLI](cli.md) · [Architecture](architecture.md) · [Use Case](use-case/README.md)

## 外部项目不增加发布流程

```text
维护并运行普通 NiceEval Eval
  → Git commit、package 或 tarball 继续交付现有项目文件
```

没有 `suite.ts`、共享发布命令、共享 manifest 或共享 release。
外部项目也不需要为共享改写 `niceeval.config.ts` 或 package exports。

这叫“零共享协议改造”，不是“任意项目无需满足 package 基本条件”。
消费方必须取得完整 Eval 输入，Eval 的普通运行期 bare dependency 也必须按 package 规则可安装。
若 npm tarball 排除了 Eval 依赖模块、Fixture、判据或 Sandbox 构建输入，应修正常规 package 内容，或直接使用包含这些文件的 Git dependency。

## 消费项目第一次挂载

```text
package manager 添加精确 package dependency
  → lockfile 写入精确安装选择
  → niceeval.config.ts 声明 package、root 与挂载 key
  → niceeval list --preflight 核对将执行的 installed identity
  → niceeval list 核对安装内容、题数与 package provenance
  → niceeval exp ... --dry 核对运行计划
  → 运行所选 Eval
```

NiceEval 自己只在安装后的本地树和 lockfile 上工作，不替用户联网安装。
这不等于流程无副作用：package manager 可能执行 install/prepare script，discovery 会执行 Eval 顶层代码，Attempt 更会运行题目逻辑。
外部 package 必须按可执行依赖审查；`niceeval list` 也不是沙箱。

挂载不会自动选择外部根的全部 Eval。
消费项目的 Experiment 可以用 `evals: ["terminal-bench/"]` 选择全套，也可用更窄前缀或 CLI 参数选择切片。

## 普通重复运行

package lock 和配置未变时，发现得到相同最终 id、源码闭包、dependency identity 与 runtime revision。
Runner 按现有携带条件复用合格的历史 Attempt，不需要外部题专用 cache。

运行期本地上传由通用 Sandbox wrapper 写入 execution-input manifest。
重复运行前重算静态 transfer plan；定义输入改变、路径逃出 owner、实际 transfer 与 plan 不一致或路径无法静态求值时保守重跑。

外部项目不参与 run-level setup 或 teardown。
每条 Eval 仍按自己的 Sandbox layer、Task 和 Assertion 生命周期运行。

## 升级外部 package

```text
package manager 选择新版本或 commit
  → 用户审阅 package.json 与 lockfile diff
  → niceeval list 核对新增、删除与 package version
  → niceeval exp ... --dry 查看逐 Eval 作废原因
  → 只运行缺失或指纹变化的 Attempt
```

删除的 Eval 不再属于当前发现结果，历史 Record 仍可读取。
新增 Eval 没有历史 Attempt，按普通缺口进入计划。

同一 Eval id 的 source、可达 dependency、runtime revision、Sandbox 或 transfer 输入改变时重跑。
package version 或 Git commit 改变但上述逐 Eval 输入相同时可以继续携带；Record 仍保留旧 execution origin，不能把旧结果归到新 commit。

## 修改共享题

消费项目不能在配置里 patch 外部 EvalDefinition。
需要改变 Task、Sandbox、Fixture 或 Assertion 时有两个明确选择：

1. 在外部 NiceEval 项目修正，并让消费方升级依赖。
2. fork 外部项目，以新的 package dependency 挂载。

把外部根的某条 Eval 复制到本地并占用同一 id 会触发重复 id 错误。
框架不会按“本地优先”静默替换外部定义。

## Git 与 workspace 消费

开发期可以使用 workspace dependency，团队私有场景可以使用 Git dependency。
两者仍由 package manager lock 保存，不增加 NiceEval 特例。

workspace 内容可能在不改 lockfile 时变化。
源码与可达 workspace dependency 按实际内容摘要作废受影响结果；发布或 CI 复现仍应使用不可变 tarball、commit 或 registry version。

外部 workspace 自己的 node_modules 可能含另一版 NiceEval。
外部模块装载器仍把 NiceEval API 绑定消费运行时，package owner 不需要为了本地开发改变依赖声明。

## 运行结束

运行结束后没有外部题专用 finalizer。
外部 package 留在项目依赖树，Sandbox 与 Attempt artifact 按原生命周期回收和保存。
