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

实现验收包含 preflight 不 import 外部代码、位置前缀、零匹配、`--json` 纯 JSON、多 package 冲突、alias 与 origin 的稳定序列化。

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

## 错误语义

| code | 条件 | 修法 |
|---|---|---|
| `eval-root.package-undeclared` | package 不是消费项目直接依赖 | 把精确 package 引用加入 package.json 并安装 |
| `eval-root.package-uninstalled` | 声明存在但本地安装树缺 package | 用项目 package manager 执行 frozen install |
| `eval-root.outside-package` | root 的真实路径逃出外部 package | 把 Eval 与资产纳入交付内容 |
| `eval-root.missing` | 安装内容没有配置的 Eval root | 修 root，或改用包含 Eval 的 package/Git 内容 |
| `eval-root.node-unsupported` | 当前 Node 不能提供 ESM/CJS 同步模块查找 hook | 使用 Node >=22.15，或不配置外部根 |
| `eval-root.niceeval-api-incompatible` | Node linker 确认 Eval 使用了消费版本不存在的 NiceEval API | 升级消费项目 NiceEval，或固定兼容的外部 package 版本 |
| `eval-root.duplicate-relative-id` | 外部根内两条入口产生同一相对 id | 在外部项目修目录结构 |
| `discovery.duplicate-id` | 本地 Eval 或另一个外部根占用最终 id | 改消费项目挂载前缀 |

普通 Eval 在 `test(t)` 中才选择的文件仍按原生命周期报错并由 Sandbox transfer wrapper 写入清单。
共享机制不承诺静态证明任意运行时代码；历史 transfer 路径无法在运行前安全重验时，该 Eval 保守地失去携带资格。

所有错误同时给出 package、root、挂载点和 package 文件。
package 不受信任时，反馈明确说明它是可执行依赖，不把它描述成只读数据下载。
