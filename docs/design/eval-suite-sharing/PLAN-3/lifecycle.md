# Lifecycle：来源项目、消费与升级

**相关文档**：[README](README.md) · [Library](library.md) · [CLI](cli.md) · [Architecture](architecture.md) · [Use Case](use-case/README.md)

## 来源项目不增加发布流程

```text
维护并运行普通 NiceEval Eval
  → Git commit、package 或 tarball 继续交付现有项目文件
```

没有 `suite.ts`、共享发布命令、共享 manifest 或共享 release。
来源项目也不需要为共享改写 `niceeval.config.ts` 或 package exports。

唯一不可省略的物理条件是消费方取得了完整 Eval 输入。
若 npm tarball 排除了 Eval 依赖模块、Fixture、判据或 Sandbox 构建输入，应修正常规 package 内容，或直接使用包含这些文件的 Git dependency。

## 消费项目第一次挂载

```text
package manager 添加精确来源 dependency
  → lockfile 写入精确解析
  → niceeval.config.ts 声明 package、root 与挂载 key
  → niceeval list 核对安装内容、题数与来源
  → niceeval exp ... --dry 核对运行计划
  → 运行所选 Eval
```

安装是唯一可能访问 registry 或 Git 的步骤。
从配置装载到 Attempt 收尾都只读取本地安装树。

挂载不会自动选择外部根的全部 Eval。
消费项目的 Experiment 可以用 `evals: ["terminal-bench/"]` 选择全套，也可用更窄前缀或 CLI 参数选择切片。

## 普通重复运行

package lock 和配置未变时，发现得到相同最终 id 与源码闭包。
Runner 按现有携带条件复用合格的历史 Attempt，不需要外部题专用 cache。

来源项目不参与 run-level setup 或 teardown。
每条 Eval 仍按自己的 Sandbox layer、Task 和 Assertion 生命周期运行。

## 升级来源

```text
package manager 解析新版本或 commit
  → 用户审阅 package.json 与 lockfile diff
  → niceeval list 核对新增、删除与来源 version
  → niceeval exp ... --dry 查看逐 Eval 作废原因
  → 只运行缺失或指纹变化的 Attempt
```

删除的 Eval 不再属于当前发现结果，历史 Record 仍可读取。
新增 Eval 没有历史 Attempt，按普通缺口进入计划。

同一 Eval id 的输入闭包改变时重跑。
package version 或 Git commit 改变但输入闭包相同时继续携带，不为发布动作支付全量运行成本。

## 修改共享题

消费项目不能在配置里 patch 外部 EvalDefinition。
需要改变 Task、Sandbox、Fixture 或 Assertion 时有两个明确选择：

1. 在来源 NiceEval 项目修正，并让消费方升级依赖。
2. fork 来源项目，以新的 package dependency 挂载。

把外部根的某条 Eval 复制到本地并占用同一 id 会触发重复 id 错误。
框架不会按“本地优先”静默覆盖来源。

## Git 与 workspace 消费

开发期可以使用 workspace dependency，团队私有场景可以使用 Git dependency。
两者仍由 package manager lock 记录，不增加 NiceEval 特例。

workspace 内容可能在不改 lockfile 时变化。
逐 Eval 源码捕获会按字节作废受影响结果；发布或 CI 复现仍应使用不可变 tarball、commit 或 registry version。

来源 workspace 自己的 node_modules 可能含另一版 NiceEval。
外部模块装载器仍把 NiceEval API 绑定消费运行时，来源方不需要为了本地开发改变依赖声明。

## 收尾

运行结束后没有外部题专用清理。
来源 package 留在项目依赖树，Sandbox 与 Attempt artifact 按原生命周期回收和保存。
