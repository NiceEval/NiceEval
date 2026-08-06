# Architecture：多发现根与单一 NiceEval 运行时

**相关文档**：[README](README.md) · [Library](library.md) · [CLI](cli.md) · [Lifecycle](lifecycle.md) · [Use Case](use-case/README.md)

## 数据流

```text
package manager 安装并锁定来源项目
  → 装载消费项目 niceeval.config.ts
  → 解析 evalRoots 中的直接 dependency 与 root
  → 本地 evals/ + 每个外部 Eval root 分别发现
  → 外部模块中的 niceeval import 绑定当前运行时
  → 外部 root 相对 id 前拼消费项目挂载前缀
  → 合并后检查最终 id 冲突
  → 捕获每条 Eval 的源码与数据输入
  → 普通 Experiment 选择与 Runner
```

外部 root 只扩展发现阶段。
合并完成后，Runner 收到的仍是 DiscoveredEval；Attempt 生命周期没有外部题分支。

## 四种路径各管一件事

| 路径 | 作用 |
|---|---|
| 消费项目 root | 定位 package.json、lockfile 与本地 `evals/` |
| 来源 package root | 依赖解析、源码捕获与资产安全边界 |
| 配置的 `root` | 外部 Eval 相对 id 的发现起点 |
| 项目挂载前缀 | 最终 Eval id 的前缀 |

来源 package root 从消费项目直接依赖的安装位置得到，不从 package main 或共享入口反推。
因此一个没有 main、exports 或 `suite.ts` 的原生 NiceEval 仓库也可复用。

最终 Eval id 不自动使用 package name。
同一来源可以在不同项目挂到不同前缀，项目内路径仍是选择、Attempt 与结果身份的唯一键。

## package root 解析

第一版只接受消费项目声明并已经安装的直接 dependency。
解析器按 package name 在项目依赖树中取得入口目录，跟随 package manager 创建的符号链接，再读取该目录的 `package.json`。

它不执行 package main，不扫描全局 cache，也不在缺包时联网安装。
未安装、未直接声明、name 不一致或 root 缺失都在发现前失败。

Node 的 node_modules 安装布局是第一版必需契约，包括 npm、pnpm 和采用 node_modules linker 的 Yarn。
Yarn Plug'n'Play 需要单独的 package locator 接口，不在第一版伪装支持。

## 单一 NiceEval 运行时

“双方都用 NiceEval”只有在 Definition 与 Sandbox 由同一个运行时解释时才天然兼容。
直接按来源文件位置执行 Node bare import，可能误取来源 workspace 的另一份 NiceEval，形成私有品牌与运行状态分叉。

外部根的模块装载器采用双解析规则：

1. `niceeval` 与 `niceeval/*` 始终解析到启动当前 CLI 的 NiceEval package。
2. Node builtin、相对 import 和其它 bare package 仍按来源文件与来源 package 解析。

这条重定向只在已声明外部 package root 的 import graph 中生效。
它不改写消费项目的普通模块解析，也不把其它 dependency 提升到消费项目根。

来源使用消费版本不存在的 NiceEval export 时，装载器不回退到来源副本。
它返回 `eval-root.niceeval-api-incompatible`，并列出 package、文件、specifier 与消费版本。

## 发现与冲突

每个根先独立完成文件扫描、模块装载，并从数组或 keyed record 生成多条 Eval。
外部 root 相对 id 合法后再拼前缀，所有根合并后一次检查重复最终 id。

冲突不能按根顺序覆盖。
错误同时列出本地文件、来源 package、root 与挂载点，使用户能判断该改哪个配置 key。

来源 root 之外的 `experiments/`、`niceeval.config.ts`、Agent 与其它文件不会被扫描。
即使这些文件随 package 存在，消费项目也不会取得它们的运行配置。

## 源码捕获 owner

本地 Eval 的 owner root 是消费项目 root。
外部 Eval 的 owner root 是来源 package root。

静态相对 import 在各自 owner root 内递归捕获。
因此来源项目的 `lib/task-fixture.ts` 改变时，只有 import 它的 Eval 指纹改变。

相对 import、loader 文件或本地资产逃出来源 package root 时，发现失败。
这条规则保证安装内容自包含，也防止一个依赖把消费项目的任意文件偷偷纳入题目。

Node builtin 与 NiceEval 运行时不作为外部 Eval 源码复制进闭包。
其它 bare package import 由项目 package lock 固定；动态 import 仍属于现有源码闭包缺口，变更后需要显式重验。

## 指纹

挂载后的指纹沿用现有两层结构：

```text
fingerprint = hash(
  configHash,
  projectEvalId,
  Eval 源码闭包,
  loader 与受管数据,
  Sandbox 与本地传输输入,
  EvalDefinition 运行字段
)
```

package name、version、root 与 repository 是来源事实，不直接进入 fingerprint。
是否携带只看实际运行输入是否相同。

这条裁决允许依赖升级只改说明，也允许 package 重组未改变的单题。
一条 Eval 的字节和资产未变时，它在同一项目 id 下继续携带。

package version 不进入 fingerprint 不表示它不可审计。
Run 保存来源投影，fingerprint manifest 保存实际文件与内容哈希，项目 package lock 保存安装解析。

## 来源落盘

Record 对每条已知 Eval 保存 ExternalEvalOrigin。
Attempt 条目引用同一份定义期来源，不在每个 artifact 重复整块文本。

结果携带到新 Run 时，使用新发现结果的外部来源，并保留原 locator 与携带链。
若 package version 改变但单题输入相同，读取面能同时看到当前来源与原结果 locator。

来源字段不包含本机绝对路径、registry token、鉴权 header 或临时下载 URL。
公开 Record 只暴露 package metadata、相对 root 与挂载点。

## 为什么没有 `eval.lock`

项目 package lock 是来源安装身份的唯一 owner。
它同时覆盖 package tarball 或 Git commit、普通 dependencies 与 NiceEval 版本。

NiceEval manifest 是运行输入解释，不承担安装。
它按 Eval 保存文件哈希，回答哪个输入改变；它不能被拿来重新安装 package，也不写回依赖选择。

把这两者再汇总进 `eval.lock` 会产生第三份过期副本。
因此 NiceEval 只读取已经安装的 package tree，不生成或修改依赖 lockfile。

## 安全边界

外部 Eval 来源是可执行依赖。
发现时会导入其中的 Eval 模块，这与安装并运行普通测试库同级。

NiceEval 不导入来源 package main 或配置，减少了无关顶层代码执行，但不能把 Eval 模块当作惰性数据。
用户仍须通过 package 来源、lockfile、代码审查与组织 registry 策略建立信任。

挂载不会放宽题目资产边界。
Docker build context、send 前上传、send 后判据与 solution 仍按现有泄漏检查和 Eval 源码顺序处理。

## 性能

外部 root 可以包含数百条 Eval。
发现器按来源 package root 缓存路径校验和文件内容哈希，多个 Eval import 同一项目内模块时只读一次物理文件。

package 版本不是全量失效键。
缓存 key 使用真实路径、文件 stat 与内容哈希，最后仍把文件投影到各 Eval 的独立 manifest。
