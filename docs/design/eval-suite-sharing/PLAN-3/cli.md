# CLI：复用现有发现与运行命令

**相关文档**：[README](README.md) · [Library](library.md) · [Architecture](architecture.md) · [Lifecycle](lifecycle.md) · [Use Case](use-case/README.md)

## 安装与升级不进入 NiceEval CLI

外部 Eval 是消费项目依赖。
用户使用项目已经选择的 package manager 安装、锁定与升级：

```sh
pnpm add -D 'github:NiceEval/terminal-bench#<commit>'
pnpm install --frozen-lockfile
```

registry、私有 package、Git、tarball 与 workspace 继续使用 package manager 原生引用。
NiceEval 不提供 `eval add`、`eval update`、`eval publish` 或 `eval sync`。

## `niceeval list`

复用现有发现命令名，让它同时扫描本地 `evals/` 和 `Config.evalRoots`。
位置参数过滤、结构化 `list --json` 与 provenance 列是本方案新增的 CLI 契约，不假装当前实现已经支持。
它承担挂载检查，不增加另一条专用 check 命令：

```sh
niceeval list
niceeval list --preflight
niceeval list terminal-bench/
niceeval list --json
```

命令文法固定为：

```text
niceeval list [<eval-prefix>] [--tag <tag>] [--json]
niceeval list --preflight [--json]
```

位置前缀最多一个。`--preflight` 与位置前缀、`--tag` 及任何执行或查看参数互斥，并且只能用于 `list`。
文法错误在读取配置前失败；普通用户错误退出 1，NiceEval 内部 invariant 或 worker crash 退出 2。

`--preflight` 只查找直接 dependency、root 和去凭据的 installed identity，不 import 外部 Eval；它让用户在执行第三方宿主代码前先看到将要信任的安装身份。
普通 `list` 也先在人读输出中展示同一 preflight，再进入 discovery。
随后 discovery 会导入外部 Eval；`list` 因此不是无副作用或安全检查。

发现外部根时验证：

- package 是项目直接 dependency，且已安装到可定位的 package root；
- root 的真实路径位于 package root 内；
- Eval 模块的默认导出形状与相对 id 合法；
- 静态 import 的项目内模块位于外部 package 内；
- 当前 Node 满足外部根 loader 的最低版本；
- Node linker 可判定的 NiceEval API 能由消费运行时提供；
- 发现期已有的隐藏输入泄漏检查继续通过；
- 同一外部根内没有重复相对 id。

人读输出增加 provenance 列：

```text
EVAL                                      SOURCE
local/smoke                               project
terminal-bench/hello-world                terminal-bench@1.0.0
terminal-bench/postgres-csv-clean         terminal-bench@1.0.0
```

位置参数按现有 Eval id 前缀过滤。
零匹配时报错并列出已发现前缀，不把空列表当成功。

`--json` 的每条 Eval 增加 `origin`，结构与 Library 的 ExternalEvalOrigin 相同。
这一个入口足以核对 package、root、挂载点、相对 id 与归属信息。

机器输出不让配置或 Eval 与协议争用同一 stdout。
父 CLI 在加载 dotenv、配置或 locale 前识别 `list --json`，用一个 fresh 子进程执行内部 worker；worker 的 stdout、stderr 与协议 fd 分离，父进程只接受一个经过 schema 解码的有界协议 frame，并独占最终输出：

- `list --preflight --json` 成功时，stdout 恰为一份 `{"format":"niceeval.eval-roots","schemaVersion":1,"roots":[...]}` 加换行，stderr 为空；
- 普通 `list --json` 成功时，stdout 恰为一份 `{"format":"niceeval.evals","schemaVersion":1,"evals":[...]}` 加换行，stderr 为空；
- 用户错误时 stdout 为空，stderr 恰为一份 `{"format":"niceeval.error","schemaVersion":1,"error":{...}}` 加换行；
- config、Eval、grandchild 向捕获的 stdout/stderr 写任何字节，返回 `eval-root.machine-output-contaminated`，不回显原字节，也不把它写入日志。

父进程持续排空两个 pipe，每个 stream 最多接受 1 MiB，worker 总时限 60 秒；超限或超时后终止整个进程树，2 秒后强制终止。
协议 fd 只接受一个长度前缀 frame，frame 上限 1 MiB；缺失、额外、超长或 schema 不合法都是 exit 2 的内部协议错误。
这些界限避免大量输出塞满 pipe，也避免 grandchild 保留 fd 令父进程永久等待。

纯 JSON 契约只适用于没有 Node preload 的受支持 CLI 启动形状。
`NODE_OPTIONS` 必须单独读取；它不会出现在 `process.execArgv`。
`NODE_OPTIONS` 或 `process.execArgv` 含 `--require`、`-r`、`--import`、`--loader` 或 `--experimental-loader` 时，silent preload 稳定报 `eval-root.preloaded-owner-unsupported`。
preloader 能在 `bin/niceeval.js` 取得控制权前自行写 stdout，因此带 preload 的启动不承诺纯 JSON；需要机器契约的调用方必须清除这些 preload 选项。

实现验收包含以下场景：

- preflight 不 import 外部代码；
- 位置前缀、零匹配、多 package 冲突与 alias；
- `--json` 纯 JSON 和 origin 的稳定序列化；
- 静默或有输出的 `NODE_OPTIONS --require` 与 `--import`；
- 超过 pipe buffer 的敌意输出；
- 持有 fd 的 grandchild。

## 发现阶段与错误聚合

所有真正消费 Eval 定义的入口共用同一条 preflight 与 discovery 管线：`list`、`check`、实验计划/运行、`accept` 与 `rename`。
`show`、`view`、`session`、`init`、`sandbox`、`docker` 等不消费 Eval 定义的命令不因配置存在 `evalRoots` 而触发 Node gate、安装检查或 process-reuse gate。
仅有本地 `evals/` 时维持原行为；静态分析无法证明完整只会使相应 Eval 不可携带，不能引入 lock adapter 错误。

管线按 barrier 失败；上一阶段有错误时不进入下一阶段，也不返回部分 root：

1. P0：命令文法，首错即停。
2. P1：加载配置，按 mount/field 聚合 `evalRoots` shape 错误；只要有外部 root，再检查 Node capability。Node 不支持优先于 package/lock 错误。
3. P2：对所有 mount 聚合直接依赖声明、安装位置、root containment、lock selection、owner 冲突与提前加载；按 mount/code/file 排序。`--preflight` 成功后即在这里停止。
4. P3：在 import 前聚合源码语法、模块装载子语言、相对路径边界与可静态确认的 NiceEval API 错误。这里的 bare dependency 查找结果只能是候选事实，不能宣称 package-instance identity。
5. P4：逐入口 discovery；以 Node/tsx hook 实际成功查找到的目标作为权威事实，再完成 bare package instance identity、dependency-unverifiable、loader 一致性与 export decode。错误按 mount/eval/source location/code 稳定聚合。
6. P5：所有 root 成功后检查最终 id 冲突，再应用 prefix/tag。零匹配返回 `list.no-match` 并列出稳定顶层前缀。

统一 issue 形状为 `{ code, mount?, dependency?, packageFile?, evalFile?, specifier?, field?, message, actions }`。
机器协议只依赖 `code` 与结构化字段；`message` 由 renderer 产生。

## `niceeval exp --dry`

计划矩阵继续以项目内 Eval id 为主。
当计划包含外部 Eval 时，摘要补 package 计数：

```text
evals  12 selected · 12 from terminal-bench@1.0.0
```

逐条作废原因仍由 fingerprint manifest 产生，包括 source、dependency、runtime revision 与历史 transfer input 的变化。
依赖升级后，用户可以在产生付费运行前看到哪些 Eval 会重跑。

普通 `niceeval exp` 不增加 package 参数。
用户继续用 Experiment 的 `evals` 和 CLI Eval 前缀选择外部题。

## `niceeval accept` 的 transfer 授权

普通 `niceeval accept @<locator>...` 遇到 execution transfer plan 不同时必须拒绝，错误码为 `accept.transfer-plan-authorization-required`，并显示当前 `planDigest`。
用户核对历史 execution-input manifest 与当前静态计划后，可显式授权精确摘要：

```sh
niceeval accept @<locator>... --accept-transfer <planDigest>
```

`--accept-transfer` 可重复；每个发生 transfer plan 差异的 locator 都必须命中一个当前 `planDigest`，未使用的 selector 以 `accept.transfer-plan-selector-unused` 拒绝，防止拼错或把宽授权带进另一批结果。
coverage 0/1 缺失 dependency、runtime 或 transfer 证明时不能使用该选项跨版本接受，必须 fresh rerun。
成功条目的 `acceptedFrom.acceptedExecutionPlanDigest` 只写入这一次被授权的当前摘要；再发生任何 plan 变化仍重新阻断。

## 错误语义

| code | 条件 | 修法 |
|---|---|---|
| `eval-root.package-undeclared` | package 不是消费项目直接依赖 | 把精确 package 引用加入 package.json 并安装 |
| `eval-root.package-uninstalled` | 声明存在但本地安装树缺 package | 用项目 package manager 执行 frozen install |
| `eval-root.installation-unverifiable` | lockfile 与安装树不能唯一证明所选 package | 使用支持的 package-manager/linker 组合，或改用可验证交付形态 |
| `eval-root.outside-package` | root 的真实路径逃出外部 package | 把 Eval 与资产纳入交付内容 |
| `eval-root.missing` | 安装内容没有配置的 Eval root | 修 root，或改用包含 Eval 的 package/Git 内容 |
| `eval-root.node-unsupported` | 当前 Node 不能提供 ESM/CJS 同步模块查找 hook | 使用 Node >=22.15，或不配置外部根 |
| `eval-root.yarn-pnp-unsupported` | 项目使用 Yarn Plug'n'Play | 改用 node-modules linker；当前契约不支持 PnP |
| `eval-root.loaded-before-registration` | 外部 owner 在 hook 注册前已进入模块缓存 | 用无 preload 的 fresh NiceEval CLI 进程重试 |
| `eval-root.preloaded-owner-unsupported` | Node preload 破坏受支持启动形状 | 清除 `NODE_OPTIONS` / `execArgv` preload |
| `eval-root.process-reuse-unsupported` | 同一进程重复或并发启动 external discovery | 每次通过 fresh NiceEval CLI 进程调用 |
| `eval-root.hook-protocol-incompatible` | 进程中已有另一版 hook protocol/runtime | 用 fresh CLI 进程并消除重复 runtime |
| `eval-root.dependency-unverifiable` | 实际查找到的 bare package instance 无法映射唯一 lock identity | 修复安装树或改用已验收的 manager/source 组合 |
| `eval-root.niceeval-api-incompatible` | Node linker 确认 Eval 使用了消费版本不存在的 NiceEval API | 升级消费项目 NiceEval，或固定兼容的外部 package 版本 |
| `eval-root.duplicate-relative-id` | 外部根内两条入口产生同一相对 id | 在外部项目修目录结构 |
| `discovery.duplicate-id` | 本地 Eval 或另一个外部根占用最终 id | 改消费项目挂载前缀 |

普通 Eval 在 `test(t)` 中才选择的文件仍按原生命周期报错并由 Sandbox transfer wrapper 写入清单。
共享机制不承诺静态证明任意运行时代码；历史 transfer 路径无法在运行前安全重验时，该 Eval 保守地失去携带资格。

所有错误同时给出 package、root、挂载点和 package 文件。
package 不受信任时，反馈明确说明它是可执行依赖，不把它描述成只读数据下载。
