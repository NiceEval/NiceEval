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

现有发现命令同时扫描本地 `evals/` 和 `Config.evalRoots`。
它承担挂载检查，不增加另一条专用 check 命令：

```sh
niceeval list
niceeval list terminal-bench/
niceeval list --json
```

发现外部根时验证：

- package 是项目直接 dependency，且已安装到可定位的 package root；
- root 的真实路径位于 package root 内；
- Eval 模块的默认导出形状与相对 id 合法；
- 静态 import 的项目内模块位于来源 package 内；
- 外部 Eval 使用的 NiceEval API 能由消费运行时提供；
- 发现期已有的隐藏输入泄漏检查继续通过；
- 同一外部根内没有重复相对 id。

人读输出增加来源列：

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

## `niceeval exp --dry`

计划矩阵继续以项目内 Eval id 为主。
当计划包含外部 Eval 时，摘要补来源计数：

```text
evals  12 selected · 12 from terminal-bench@1.0.0
```

逐条作废原因仍由 fingerprint manifest 产生。
依赖升级后，用户可以在产生付费运行前看到哪些 Eval 会重跑。

普通 `niceeval exp` 不增加来源参数。
用户继续用 Experiment 的 `evals` 和 CLI Eval 前缀选择外部题。

## 错误语义

| code | 条件 | 修法 |
|---|---|---|
| `eval-root.package-undeclared` | package 不是消费项目直接依赖 | 把精确来源加入 package.json 并安装 |
| `eval-root.package-uninstalled` | 声明存在但本地安装树缺 package | 用项目 package manager 执行 frozen install |
| `eval-root.package-name-mismatch` | 安装目录的 package.json name 与声明不一致 | 修 dependency alias 或配置中的 package |
| `eval-root.outside-package` | root 的真实路径逃出来源 package | 把 Eval 与资产纳入交付内容 |
| `eval-root.missing` | 安装内容没有配置的 Eval root | 修 root，或改用包含 Eval 的 package/Git 来源 |
| `eval-root.niceeval-api-incompatible` | Eval 使用了消费版本不存在的 NiceEval API | 升级消费项目 NiceEval，或固定兼容的来源版本 |
| `eval-root.duplicate-relative-id` | 外部根内两条入口产生同一相对 id | 在来源项目修目录结构 |
| `discovery.duplicate-id` | 本地 Eval 或另一个外部根占用最终 id | 改消费项目挂载前缀 |

普通 Eval 在 `test(t)` 中才读取的文件仍按原生命周期报错。
共享机制不承诺通过静态扫描提前证明任意运行时代码会读取的全部资产。

所有错误同时给出 package、root、挂载点和来源文件。
来源不受信任时，反馈明确说明它是可执行依赖，不把它描述成只读数据下载。
