# Architecture：多发现根与单一 NiceEval 运行时

**相关文档**：[README](README.md) · [Library](library.md) · [CLI](cli.md) · [Lifecycle](lifecycle.md) · [Use Case](use-case/README.md)

## 数据流

```text
package manager 安装并锁定外部项目
  → 装载消费项目 niceeval.config.ts
  → 查找 evalRoots 中的直接 dependency、精确安装身份与 root
  → 本地 evals/ + 每个外部 Eval root 分别发现
  → 外部模块中的 niceeval import 绑定当前运行时
  → 外部 root 相对 id 前拼消费项目挂载前缀
  → 合并后检查最终 id 冲突
  → 捕获每条 Eval 的模块图、依赖身份与数据输入
  → 普通 Experiment 选择与 Runner
```

外部 root 不增加第二种 Eval 或 Attempt。
但 `DiscoveredEval` 必须携带 owner capability、模块事实与 package provenance；Runner 的通用路径能力据此同时约束本地题与外部题，不能只改扫描目录便宣称实现完成。

## 四种路径各管一件事

| 路径 | 作用 |
|---|---|
| 消费项目 root | 定位 package.json、lockfile 与本地 `evals/` |
| 外部 package root | 依赖查找、源码捕获与资产安全边界 |
| 配置的 `root` | 外部 Eval 相对 id 的发现起点 |
| 项目挂载前缀 | 最终 Eval id 的前缀 |

外部 package root 从消费项目直接依赖的安装位置得到，不从 package main 或共享入口反推。
因此一个没有 main、exports 或 `suite.ts` 的原生 NiceEval 仓库也可复用。

最终 Eval id 不自动使用 package name。
同一外部 package 可以在不同项目挂到不同前缀，项目内路径仍是选择、Attempt 与结果身份的唯一键。

## package root 查找

第一版只接受消费项目声明并已经安装的直接 dependency。
package locator 按消费项目 dependency key 在项目依赖树中取得入口目录，跟随 package manager 创建的符号链接，再读取该目录的 `package.json`。

它不执行 package main，不扫描全局 cache，也不在缺包时联网安装。
未安装、未直接声明或 root 缺失都在发现前失败。
dependency alias 合法；dependency key 与安装后 manifest 的 `name` 是两个字段，不要求相等，因此同一个 package 的两个 alias 可以挂到不同前缀。

Node 的 node_modules 安装布局是第一版必需契约，包括 npm、pnpm 和采用 node_modules linker 的 Yarn。
Yarn Plug'n'Play 需要单独的 package locator 接口，不在第一版伪装支持。

## 单一 NiceEval 运行时

“双方都用 NiceEval”只有在 Definition 与 Sandbox 由同一个运行时解释时才天然兼容。
直接按外部文件位置执行 Node bare import，可能误取外部 workspace 的另一份 NiceEval，形成私有品牌与运行状态分叉。

外部根的模块装载器采用双重查找规则：

1. `niceeval` 与 `niceeval/*` 始终指向启动当前 CLI 的 NiceEval package。
2. Node builtin、相对 import 和其它 bare package 仍按外部文件与所属 package 查找。

这条重定向只对 importer 真实路径位于已声明外部 package root 内的模块生效。
它不改写消费项目的普通模块查找，也不把其它 dependency 提升到消费项目根。
传递 dependency 若在自己的 package 内 import NiceEval，不自动取得重定向；第一版不支持用这种插件返回 NiceEval 私有品牌对象。

该规则不能停留在“装载器会重定向”的描述。
第一版 `evalRoots` 是 **Node >=22.15** 的 feature gate。CLI 必须在动态导入配置或 Eval 前注册 [`node:module.registerHooks()`](https://nodejs.org/api/module.html#moduleregisterhooksoptions) 同步模块查找 hook，再与 tsx 的 ESM/CJS 转译 hook 按固定顺序组成链。
NiceEval 包的其它能力可以继续支持更低 Node；在低版本使用 `evalRoots` 必须于执行任何第三方代码前报 `eval-root.node-unsupported`。

实现进入主线前必须用真实安装矩阵证明这条链，而不是只做单元 mock。矩阵包含：

- Node 22/24；
- ESM/CJS 外部 package；
- npm/pnpm/Yarn node-modules linker；
- 外部 package 内存在另一版 NiceEval；
- 外部 package 自己的 `package.json#type` 与 `tsconfig.json`。

每个 owner 使用自己的 TypeScript 编译上下文。模块图来自 Node 实际查找结果与语法树，不能继续用正则近似 import。

外部 Eval 使用消费版本不存在的 NiceEval export 时，装载器不回退到外部副本。
Node linker 能明确识别的 subpath 或 named-export 错误返回 `eval-root.niceeval-api-incompatible`，并列出 package、文件、specifier 与消费版本。
CJS 属性读取或运行期动态访问无法静态判断时，保留带 origin 的普通 import/执行错误。

## 发现与冲突

每个根先独立完成文件扫描、模块装载，并从数组或 keyed record 生成多条 Eval。
外部 root 相对 id 合法后再拼前缀，所有根合并后一次检查重复最终 id。

冲突不能按根顺序覆写。
错误同时列出本地文件、外部 package、root 与挂载点，使用户能判断该改哪个配置 key。

外部 root 之外的 `experiments/`、`niceeval.config.ts`、Agent 与其它文件不会被扫描。
即使这些文件随 package 存在，消费项目也不会取得它们的运行配置。

## 源码捕获 owner

本地 Eval 的 owner root 是消费项目 root。
外部 Eval 的 owner root 是外部 package root。

`DiscoveredEval` 的内部事实至少包含 `ownerRoot`、`evalRoot`、`baseDir`、`sourcePath`、模块依赖事实和 definition origin。
`ownerRoot` 不是展示 metadata，而是所有 NiceEval 受管宿主路径的 capability 边界。

静态相对 import 在各自 owner root 内递归捕获。
因此外部项目的 `lib/task-fixture.ts` 改变时，只有 import 它的 Eval 指纹改变。

相对 import、loader 文件、Sandbox build context、bind mount 或运行期 upload 的本地源路径逃出外部 package root 时失败。
这条规则保证安装内容自包含，也防止一个依赖把消费项目的任意文件偷偷纳入题目。
校验使用 realpath 后的跨平台祖先关系，不使用字符串 `startsWith`；不存在的目标先校验最近已存在祖先，再在创建或读取时复核。

Node builtin 与 NiceEval 运行时源码不复制进闭包，但 NiceEval 的稳定 runtime contract revision 必须进入指纹。
静态可达 bare dependency 保存实际命中的 package locator 与安装内容摘要；workspace/file/link package 按真实内容摘要，而不是只信 lockfile 文本。
无法完备查明的动态 import、非字面量 CJS require 或运行期依赖使该 Eval 失去携带资格，不允许以文档提醒代替保守失效。

发现不能依赖“每条入口重复求值”来收集 loader 事实，因为 Node 会缓存共享模块。
实现必须保存模块 DAG 与每个模块登记的数据事实，再把传递闭包投影到每条 Eval；同一共享模块被两条 Eval import 时，两条都得到它登记的 loader、criteria 与 private 输入。

## 指纹

挂载后的指纹沿用现有两层结构：

```text
fingerprint = hash(
  configHash,
  projectEvalId,
  Eval 源码闭包,
  静态可达 bare dependency 身份,
  NiceEval runtime contract revision,
  loader 与受管数据,
  Sandbox 身份,
  可重验的本地传输输入,
  EvalDefinition 运行字段
)
```

package 的展示 name、version、root 与 repository 是 provenance 事实，不直接作为整套题失效键。
是否携带只看实际运行输入是否相同。

这条裁决允许依赖升级只改说明，也允许 package 重组未改变的单题。
一条 Eval 的字节和资产未变时，它在同一项目 id 下继续携带。

package version 不进入 fingerprint 不表示 package dependency 可以不进入指纹。
manifest 对每条 Eval 保存实际可达 dependency 的 locator/content identity；这使一个 parser 升级只作废使用它的题，而不是让所有外部题全量失效或错误携带。

普通 `uploadFile` / `uploadDirectory` 不要求发布方改写成共享 API。
发现期以真实模块图和语法树建立 transfer plan。能静态求值的 folder-local string 或 `new URL(..., import.meta.url)` 在计划期展开、哈希。

非字面量路径或取决于运行期分支的 transfer 将 Eval 标为不可携带。
Attempt 执行时，Sandbox 包装层再写入 owner-relative 文件集合、内容摘要以及发生在 `send` 前还是后。
Record 保存 execution-input manifest，并验证实际 transfer 与静态 plan 一致。

下一次计划只有在 definition 输入未变且 transfer plan 能在 owner 内完整重算时才可携带；历史执行清单是审计与一致性证据，不能单独把任意动态路径变成安全 cache key。
这项 transfer manifest 是实现 `evalRoots` 前必须先补齐的 NiceEval 通用能力，不是发布方 manifest。

## Provenance 落盘

Record 对每条已知 Eval 保存 definition origin，其中包含去凭据后的 source kind、Git commit 或 registry/tarball integrity、lockfile kind 与稳定摘要。
package.json 的 name/version 只是展示字段，不能替代精确安装身份；Terminal-Bench 固定写着 `1.0.0` 时仍须能区分两个 Git commit。

fresh Attempt 另存 execution origin。
Attempt 条目可以引用 Record 内去重的 provenance 表，不在每个 artifact 重复整块文本。

结果携带到新 Run 时，definition origin 更新为本轮发现的 package provenance，execution origin 仍保留真正执行该 Attempt 的旧 provenance，并保留原 locator 与携带链。
若 package provenance 改变但单题输入相同，读取面能同时回答“现在定义来自哪里”和“这个结果当时执行了什么字节”。

provenance 字段不包含本机绝对路径、registry token、鉴权 header 或临时下载 URL。
公开 Record 暴露可审计但去凭据的 installed identity，不暴露本机绝对路径。

## 为什么没有 `eval.lock`

项目 package lock 是依赖选择与安装身份的唯一 owner。
它同时涵盖 package tarball 或 Git commit、普通 dependencies 与 NiceEval 版本。

NiceEval manifest 是 package lock 和安装树对当前 Eval 的只读投影，不承担安装。
它按 Eval保存文件哈希、可达 dependency identity、runtime revision 与 transfer 输入，回答哪个输入改变；它不能被拿来重新安装 package，也不写回依赖选择。

把这两者再汇总进 `eval.lock` 会产生第三份过期副本。
因此 NiceEval 只读取已经安装的 package tree 与消费项目 lockfile，不生成或修改依赖 lockfile。

## 安全边界

外部 Eval package 是可执行依赖。
发现时会导入其中的 Eval 模块，这与安装并运行普通测试库同级。

`niceeval list` 不是安全沙箱或无副作用预览：package manager [安装阶段可能执行 lifecycle script](https://docs.npmjs.com/cli/using-npm/scripts/)，发现阶段也会执行 Eval 与共享模块的顶层代码。
在 import 前，CLI 应先输出或通过机器读 preflight 暴露 dependency key 与 installed identity；团队可配合 `ignore-scripts`、registry allowlist、代码审查与 package 签名策略。
lockfile 提供可复现选择，不证明代码善意。

NiceEval 不导入外部 package main 或配置，减少了无关顶层代码执行，但不能把 Eval 模块当作惰性数据。
用户仍须通过 package provenance、lockfile、代码审查与组织 registry 策略建立信任。

挂载不会放宽题目资产边界。
Docker build context、send 前上传、send 后判据与 solution 仍按现有泄漏检查和 Eval 源码顺序处理。

## 性能

外部 root 可以包含数百条 Eval。
发现器按外部 package root 缓存路径校验和文件内容哈希，多个 Eval import 同一项目内模块时只读一次物理文件。

package 版本不是全量失效键。
缓存 key 使用真实路径、文件 stat 与内容哈希，最后仍把文件投影到各 Eval 的独立 manifest。
