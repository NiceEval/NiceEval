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
传递 dependency 若在自己的 package 内 import NiceEval，不自动取得重定向；这种插件不能返回 NiceEval 私有品牌对象。

该规则不能停留在“装载器会重定向”的描述。
`evalRoots` 是 **Node >=22.15** 的 feature gate。CLI 必须在动态导入配置或 Eval 前注册 [`node:module.registerHooks()`](https://nodejs.org/api/module.html#moduleregisterhooksoptions) 同步模块查找 hook，再与 tsx 的 ESM/CJS 转译 hook 按固定顺序组成链。
NiceEval 包的其它能力可以继续支持更低 Node；在低版本使用 `evalRoots` 必须于执行任何第三方代码前报 `eval-root.node-unsupported`。

外部 root 只支持 fresh CLI process 中的一次 invocation。
进程级 hook 只安装一次；owner→canonical runtime capability 存在 `AsyncLocalStorage` 的单次 invocation state 中，从 config 延续到 discovery、planning 与 Attempt，main 结束即撤销。
没有 state 时 hook 只委托；同一进程重复或并发 external invocation 报 `eval-root.process-reuse-unsupported`，local-only invocation 不受影响。

全局 `Symbol.for` 协议先且只解码 `protocolVersion` 与 `ownerRuntimeRoot`。
相同协议/runtime 重复安装幂等；版本或 runtime 不同报 `eval-root.hook-protocol-incompatible`，不得读取剩余字段或替换旧状态。
CLI bootstrap 与 preload 的支持边界见 [CLI](cli.md#niceeval-list)：hook 在配置求值前注册，但 Node preload 发生得更早，因此 preload 不是受支持的 machine 启动形状。

实现进入主线前必须用真实安装矩阵证明这条链，而不是只做单元 mock。矩阵包含：

- Node 22/24；
- ESM/CJS 外部 package；
- npm/pnpm/Yarn node-modules linker；
- 外部 package 内存在另一版 NiceEval；
- 外部 package 自己的 `package.json#type` 与 `tsconfig.json`。

每个 owner 使用自己的 TypeScript 编译上下文。模块图来自 Node 实际查找结果与 TypeScript compiler AST，不能继续用正则近似 import；`typescript` 编译器 API 必须是发布包 runtime dependency，不能依赖开发 checkout 偶然存在。

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
bare dependency 可以位于 hoisted 或 nested `node_modules`；进入该 dependency 后，其相对边改以实际 package root 为边界。
这条规则保证安装内容自包含，并拦截稳定输入树中的意外逃逸。
校验使用 realpath 后的跨平台祖先关系，不使用字符串 `startsWith`；不存在的目标先校验最近已存在祖先，再在创建或读取时复核。

外部 package 本来就是会执行任意顶层代码的受信任依赖。契约假设它的安装树在一次 invocation 内非对抗且稳定。
owner containment 不是抵抗同一进程恶意代码并发替换 symlink/path 的安全沙箱；我们不以 `realpath → readFile` 声称关闭这种竞态。
静态 symlink 逃逸仍须拒绝，若调用方需要抵抗恶意 package，应在只读/不可变文件系统或独立 OS sandbox 中运行 NiceEval。

Node builtin 与 NiceEval 运行时源码不复制进闭包，但 NiceEval 的稳定 runtime contract revision 必须进入指纹。
静态可达 bare dependency 保存实际命中的 package locator 与安装内容摘要；workspace/file/link package 按真实内容摘要，而不是只信 lockfile 文本。

P3 的 AST 只产生候选 specifier。权威 target、conditions 与 package instance 必须来自 P4 中 Node/tsx hook 实际成功查找到的目标。
每个实际 bare target 再交给 package-manager adapter 的 `identifyInstance`。
该调用接收 `{ physicalPackageRoot, parentModule, specifier }`，并返回 portable lock identity；零匹配或多匹配报 `eval-root.dependency-unverifiable`。
自写一个近似 Node 的模块查找实现不能充当身份事实。

各 package-manager adapter 的输入固定如下：

- npm 使用 package-lock `packages` 的 lock-root-relative logical path；
- pnpm 结合 lock snapshot、`.modules.yaml` 与 virtual-store locator，并保留 peer suffix；
- Yarn Berry node-modules linker 结合 `yarn.lock` 与 `.yarn-state.yml`；
- Yarn v1 结合父声明 selector、安装后的 name/version/resolution 与 logical path。

同 locator 的重复物理实例仍以 portable logical install path 区分。
workspace/file 走明确的 content-digest 分支，不虚构 lock node；无法把实际 root 唯一映射到声明时仍报 unverifiable。
无法完备查明的动态 import、非字面量 CJS require 或运行期依赖使该 Eval 失去携带资格，不允许以文档提醒代替保守失效。

发现不能依赖“每条入口重复求值”来收集 loader 事实，因为 Node 会缓存共享模块。
实现必须保存模块 DAG 与每个模块登记的数据事实，再把传递闭包投影到每条 Eval；同一共享模块被两条 Eval import 时，两条都得到它登记的 loader、criteria 与 private 输入。

可携带的模块装载子语言只包含：

- static import/export-from，忽略 `import type` / `export type`；
- 模块顶层且 discovery 实际执行并被 hook 观察到的 literal `import()`；
- 模块顶层、未 shadow 且被实际观察的 literal `require()`。

以下能力允许 fresh run，但将该 Eval 标为不可携带：

- 函数或分支内未执行的动态边；
- nonliteral import/require、`createRequire` 或 `module.require`；
- `eval`、`Function`、`node:vm`、Worker 或 child process；
- 自定义 loader、native `.node`；
- 分析器不能证明的别名或计算式装载能力。

分析递归遍历 owner 与已经由 hook 找到的 JS/TS dependency source。
hook 在 Attempt 内继续观察；planned DAG 外出现新的父模块/specifier/conditions/target 边时，写入该 Attempt 的 execution manifest，增加结构化 `runtime-module-edge` limitation，并令它不可携带。

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

非字面量路径或取决于运行期分支的 transfer 没有静态 plan entry；它仍可 fresh run，但写 `dynamic-transfer` limitation 并不可携带。
已有静态 plan entry 的调用必须匹配计划；没有 entry 的动态调用不能被误判为 plan mismatch。

Attempt 执行时，Sandbox 包装层先生成私有不可变 snapshot，再让 provider 从同一份 snapshot 发送：

- 文件只读一次，以同一 bytes 计算 hash 并写入临时普通文件；
- 目录按稳定顺序遍历，拒绝 escape、cycle 与 special file；
- 读取到的目录 bytes 写成无 symlink 临时树。

snapshot 与已有静态计划不符时不调用 provider，Attempt errored。
动态调用没有计划可比，照常从 snapshot 发送但不可携带。
provider 部分失败时 Attempt errored；execution manifest 写入 failed status 和已经确定的 digest。

临时路径不进入 Record 或错误，provider 返回后按有界时限删除临时目录。
`uploadDirectory` 省略 targetDir 时规范化为 portable `$WORKDIR`。
Record 持久化完整 execution-input manifest，包括 owner-relative source/target、文件 hash、send 次序、status 与 runtime module edges；它不保存源字节。

下一次计划只有在 definition 输入未变且 transfer plan 能在 owner 内完整重算时才可携带；历史执行清单是审计与一致性证据，不能单独把任意动态路径变成安全 cache key。
这项 transfer manifest 是实现 `evalRoots` 前必须先补齐的 NiceEval 通用能力，不是发布方 manifest。

## runtime contract closure

`build:package` 从两类入口生成 `dist/runtime-contract-manifest.json`：

- 公开 Eval runtime：`niceeval`、`niceeval/loaders`、`niceeval/sandbox`、`niceeval/expect`；
- 内部语义入口：discovery/module graph、fingerprint/manifest、context transfer wrapper、Sandbox transfer normalization。

它沿 TypeScript AST 的相对边建立正向闭包，列出 canonical CJS 文件及内容 hash；CLI/report-only 文件未被入口触达时自然排除，不使用 `require.cache` 或手写 denylist。

bare runtime 边写入实际 package identity 与入口。
运行规划时必须重新查找并哈希消费安装树中的实际文件，不能只信构建时 manifest。
optional peer 的 literal dynamic import 表示为条件边。未选择相应 provider 时以 `not-selected` 保留，不要求安装；选择 provider 后才要求 Node 找到它并纳入 runtime face。

tsx/esbuild 的平台 binary、native addon 或其它动态边若不能完整证明，则只使相关 Eval 不可携带，不能让未选择的 optional provider 阻断 clean consumer。
manifest 同时包含 contract revision、Node 完整版本与 hook/analysis protocol revision；package build 必须验证入口可查找、闭包非空。

## Provenance 落盘

Record 对每条已知 Eval 保存 definition origin，其中包含去凭据后的 source kind、Git commit 或 registry/tarball integrity、lockfile kind 与稳定摘要。
package.json 的 name/version 只是展示字段，不能替代精确安装身份；Terminal-Bench 固定写着 `1.0.0` 时仍须能区分两个 Git commit。

fresh Attempt 另存 execution origin。
为保持 schema 15 与旧 publish 兼容，每条 `result.json` 必须完整内联三项事实：`definitionOrigin`、`executionOrigin` 与 `executionInputs`。
`run.json.definitionOrigins` 只是本轮全部 Eval 的索引，不能成为唯一事实源。

`executionInputs` 包含 version、digest、planDigest、eligible、结构化 limitations、transfer entries 与 runtimeModuleEdges。
旧 writer 会保留 attempt 未知字段但会白名单重建 run metadata，因此任何只存在 run-level map 的 provenance 都不满足兼容性。

这些 optional 字段不触发 schema bump；代价是 result 文件可能变大。
publish 仍执行既有 50 MiB 单文件全量预检，超限必须在创建目标目录或写任何文件前整体失败。
HEAD 旧版 binary 必须真实验收 publish/copy 后三项 inline 字段语义等价保留；做不到就不能以 schema 15 发布该功能。

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

workspace/file 的 `contentDigest` 使用一套固定 canonical tree：

- 顶层 owner symlink 先求出 package root，不把机器绝对路径写入摘要；
- package root realpath 是路径边界；
- 路径改为 `/` 分隔的 root-relative 字节序列，不做 Unicode/case folding，并按 UTF-8 字节序排序；
- 普通文件项编码 type、path、size 与 bytes sha256；
- 内部 symlink 编码规范化后的 root-relative target，并递归纳入 referent；
- 逃出 root、循环或 special file 均 unverifiable；
- 任意层级名为 `node_modules`、`.git`、`.hg`、`.svn`、`.niceeval` 的目录不进入摘要；
- 根下 `.yarn/cache`、`.yarn/unplugged`、`.pnpm-store` 不进入摘要；
- 其它文件，包括 package.json 与 lockfile，均进入摘要。

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
