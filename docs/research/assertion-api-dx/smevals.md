# Prime Radiant smevals：断言、判分与 regrade 作者指南

> - 观察日期：2026-08-09
> - 观察对象：Prime Radiant 官方仓库 `prime-radiant-inc/smevals`
> - 主快照：commit `0067c0da2f28f534f9daf1ef4c37181450ddfa28`
> - 发布快照：PyPI `smevals==0.2.0`，tag `acfcbb1fbf8da8ee371bfbfffbbe195265681aea`

本文盘点 smevals 中与断言、Checker、Grader、metric、判定、聚合和 regrade 直接有关的公开作者面。
它不比较模型 Provider、托管服务或无关的观测 SDK。

文中的“官方事实”来自固定 commit 的 README、源码、测试、示例和发布元数据。
“研究判断”会显式标注，不把项目介绍语扩写成 API 承诺。

## 1. 定位与真实边界

### 名称排歧

这里的 smevals 由下面这组身份共同确定：

| 身份 | 精确值 | 官方依据 |
|---|---|---|
| GitHub 仓库 | `prime-radiant-inc/smevals` | [固定 commit](https://github.com/prime-radiant-inc/smevals/tree/0067c0da2f28f534f9daf1ef4c37181450ddfa28) |
| Python 包 | `smevals` | [PyPI 0.2.0](https://pypi.org/project/smevals/0.2.0/) |
| CLI | `smevals` | [`pyproject.toml` 的 console script](https://github.com/prime-radiant-inc/smevals/blob/0067c0da2f28f534f9daf1ef4c37181450ddfa28/pyproject.toml#L17-L18) |
| 包作者元数据 | Simon Willison | [`pyproject.toml`](https://github.com/prime-radiant-inc/smevals/blob/0067c0da2f28f534f9daf1ef4c37181450ddfa28/pyproject.toml#L8-L10) |
| 项目生命周期 | `experimental` | [`ABOUT.md`](https://github.com/prime-radiant-inc/smevals/blob/0067c0da2f28f534f9daf1ef4c37181450ddfa28/ABOUT.md#L1-L8) |

它不是 SemEval，也不是 `smallevals`、ShanMa Eval Toolbox、Lean 的 `smeval` 或其它同名服务。
仓库历史曾使用单数命令 `smeval`，但发布前改成复数 `smevals`。
0.2.0 的进程变量前缀也统一为 `SMEVALS_`，不应再照抄 `SMEVAL_`。
这两项可由[改名 commit](https://github.com/prime-radiant-inc/smevals/commit/afa774fb9cb03cad0213caf8873f3f80190be1f7)和[0.2.0 release note](https://github.com/prime-radiant-inc/smevals/releases/tag/0.2.0)核对。

### 产品实际提供什么

smevals 是 Python 3.10 以上的本地 CLI。
作者用 YAML 定义 Eval、Task、Config 和 Grader，再用任意可执行文件实现 Runner 与自定义 Checker。
核心只依赖 Click 和 PyYAML，不内置模型调用 SDK。
这些边界见[包元数据](https://github.com/prime-radiant-inc/smevals/blob/0067c0da2f28f534f9daf1ef4c37181450ddfa28/pyproject.toml#L1-L18)。

公开作者面不是可 import 的 Python 断言库。
官方 README 只承诺目录、YAML、CLI 和子进程变量协议，[`__init__.py`](https://github.com/prime-radiant-inc/smevals/blob/0067c0da2f28f534f9daf1ef4c37181450ddfa28/src/smevals/__init__.py) 也没有导出。
因此，本文不会把 `smevals.cli` 中可被 Python 偶然 import 的函数当成稳定 API。

它的判分单位是单个 Run。
Grader 依序执行 Checks，生成一个 Grade；report 再按 Config 与 model 汇总多个 Grade。
它没有数据集级准入公式、权重表达式或统计显著性判定。

Runner 负责真正调用模型或 Agent harness。
smevals 只给 Runner 输入、捕获输出，并把 Runner 退出码解释为执行成功或基础设施失败。
Checker 也由同步子进程承载，不享有隔离、超时或资源限制。

### 一个需要警惕的 Config 边界

官方词汇页说 Config 可以包含模型参数、system prompt、tools 和其它设置。
观察源码只消费 `runner` 与 `model`，并只把 Config 名、Runner 路径和 model 写入 `run.yaml`。
其它 Config 字段没有对应的 `SMEVALS_CONFIG_*` 或完整 JSON 通道。
这是可核对的实现边界，不应依据介绍语猜出一套不存在的传参协议。

## 2. 观察版本和一手链接

### 版本断层

观察 commit 的 `pyproject.toml` 仍写 `0.2.0`，但它位于 0.2.0 tag 之后 9 个提交。
因此，`smevals --version` 在发布包与观察 commit 上都会显示 `0.2.0`。
版本字符串不能证明两者行为相同。

| 能力 | PyPI 0.2.0 | commit `0067c0d` |
|---|---:|---:|
| 六个基础子命令 | 有 | 有 |
| `run -n/--repeat` | 无 | 有 |
| 失败 Run 不计入 `-n` | 不适用 | 有 |
| 失败 Run 不进入 grade/report | 无此处理 | 有 |
| 对应测试 | 发布包未携带仓库测试 | 88 项通过 |

差异可在[官方 compare](https://github.com/prime-radiant-inc/smevals/compare/0.2.0...0067c0da2f28f534f9daf1ef4c37181450ddfa28)中逐行核对。
除非小节明确写“PyPI 0.2.0”，下文行为都以 commit `0067c0d` 为准。

### 固定材料表

后文 API 表的“依据”列引用这里的编号。

| 编号 | 一手材料 | 可定位内容 |
|---|---|---|
| M1 | [README：词汇、目录和首个 Eval](https://github.com/prime-radiant-inc/smevals/blob/0067c0da2f28f534f9daf1ef4c37181450ddfa28/README.md#L18-L143) | Eval、Task、Config、Run、Grader、Check、Checker、Grade |
| M2 | [README：Runner 协议](https://github.com/prime-radiant-inc/smevals/blob/0067c0da2f28f534f9daf1ef4c37181450ddfa28/README.md#L145-L162) | Runner 输入、cwd、stdout、stderr、退出码、artifact |
| M3 | [README：Grader 与 Checker 协议](https://github.com/prime-radiant-inc/smevals/blob/0067c0da2f28f534f9daf1ef4c37181450ddfa28/README.md#L164-L225) | Check 配置、内置 Checker、结果 JSON、分数与判定 |
| M4 | [README：Run、Grade 与 regrade](https://github.com/prime-radiant-inc/smevals/blob/0067c0da2f28f534f9daf1ef4c37181450ddfa28/README.md#L227-L252) | 目录 shape、Grader 快照、多 Grader、`--regrade` |
| M5 | [README：全部命令](https://github.com/prime-radiant-inc/smevals/blob/0067c0da2f28f534f9daf1ef4c37181450ddfa28/README.md#L254-L292) | `run`、`grade`、`report`、`serve`、`build`、`docs` |
| C1 | [源码：YAML、路径、tag 与子进程变量](https://github.com/prime-radiant-inc/smevals/blob/0067c0da2f28f534f9daf1ef4c37181450ddfa28/src/smevals/cli.py#L46-L127) | fallback、key 规范化、Checker 输出规范化 |
| C2 | [源码：`run`](https://github.com/prime-radiant-inc/smevals/blob/0067c0da2f28f534f9daf1ef4c37181450ddfa28/src/smevals/cli.py#L128-L335) | 选项、串行顺序、`-n`、Run shape、Runner 执行 |
| C3 | [源码：`grade` 与全部 Checker](https://github.com/prime-radiant-inc/smevals/blob/0067c0da2f28f534f9daf1ef4c37181450ddfa28/src/smevals/cli.py#L337-L541) | skip、`score: null`、阈值、regrade、两个内置 Checker |
| C4 | [源码：report 与聚合](https://github.com/prime-radiant-inc/smevals/blob/0067c0da2f28f534f9daf1ef4c37181450ddfa28/src/smevals/cli.py#L628-L842) | JSON 行、mean、stderr、布尔率、tag share |
| H1 | [源码：live/static site 数据层](https://github.com/prime-radiant-inc/smevals/blob/0067c0da2f28f534f9daf1ef4c37181450ddfa28/src/smevals/site.py#L46-L145) | web UI 读取的 Run、Grade、Check 与 artifact 字段 |
| E1 | [官方 haiku 示例](https://github.com/prime-radiant-inc/smevals/tree/0067c0da2f28f534f9daf1ef4c37181450ddfa28/examples/haiku) | 确定性结构检查与文本 Judge |
| E2 | [官方 markdown-tables 示例](https://github.com/prime-radiant-inc/smevals/tree/0067c0da2f28f534f9daf1ef4c37181450ddfa28/examples/markdown-tables) | Task 自定义字段、确定性 metric 与部分分 |
| E3 | [官方 pelican SVG 示例](https://github.com/prime-radiant-inc/smevals/tree/0067c0da2f28f534f9daf1ef4c37181450ddfa28/examples/pelican-riding-a-bicycle) | ordered checks、`creates`、artifact 与视觉 Judge |
| T1 | [官方 grade 测试](https://github.com/prime-radiant-inc/smevals/blob/0067c0da2f28f534f9daf1ef4c37181450ddfa28/tests/test_grade.py) | 失败、skip、无分、最后分数、regrade 边界 |
| T2 | [官方 run 测试](https://github.com/prime-radiant-inc/smevals/blob/0067c0da2f28f534f9daf1ef4c37181450ddfa28/tests/test_run.py) | Runner 协议、`-n`、失败 Run、模型与 Task 选择 |
| T3 | [官方 report 测试](https://github.com/prime-radiant-inc/smevals/blob/0067c0da2f28f534f9daf1ef4c37181450ddfa28/tests/test_report.py) | 排名、metric、tag、`--json` 与失败 Run 排除 |

### 发布元数据

PyPI 0.2.0 于 2026-07-18 上传，要求 Python 3.10 以上，且没有被 yank。
固定文件摘要如下，数据来自[PyPI JSON API](https://pypi.org/pypi/smevals/0.2.0/json)。

| 文件 | SHA-256 |
|---|---|
| `smevals-0.2.0-py3-none-any.whl` | `ff4f52ba50efa16279738f00f4f2f0b760e04f815304e804d765d16853e7055b` |
| `smevals-0.2.0.tar.gz` | `4b6d755df8c7c71c29bdb2042ce615209e1d85a27ac7af9ae91c0b6539715cc7` |

## 3. 安装、最小项目与首个可运行 eval

### 选择发布包或观察 commit

只需要 0.2.0 发布行为时，按官方 README 固定版本：

```bash
uv tool install smevals==0.2.0
```

要复现本文全部行为，应固定 Git commit：

```bash
uv tool install \
  'git+https://github.com/prime-radiant-inc/smevals.git@0067c0da2f28f534f9daf1ef4c37181450ddfa28'
```

也可以不持久安装，直接运行固定 commit：

```bash
uvx --from \
  'git+https://github.com/prime-radiant-inc/smevals.git@0067c0da2f28f534f9daf1ef4c37181450ddfa28' \
  smevals --help
```

VCS tool 安装形状来自 [uv 官方 tools 指南](https://docs.astral.sh/uv/guides/tools/#requesting-different-sources)。
本次用隔离的临时 tool 目录实际执行了固定 commit 安装，CLI 可启动，但 `--version` 仍显示 `0.2.0`。

### 最小目录

下面的 local smoke Eval 不调用模型，也不需要 API key。
它只验证目录、Runner、内置 `contains` 和即时 grade 是否接通。
文件 shape 缩自官方[M1]示例，没有引入额外 API。

```text
local-smoke/
├── eval.yaml
├── tasks/
│   └── ready.yaml
├── configs/
│   └── default.yaml
├── graders/
│   └── default.yaml
└── run-local
```

`local-smoke/eval.yaml`：

```yaml
name: local-smoke
description: Verify the smevals file and process contracts locally.
```

`local-smoke/tasks/ready.yaml`：

```yaml
name: ready
prompt: SMEVALS_READY
```

`local-smoke/configs/default.yaml`：

```yaml
name: default
runner: ../run-local
model: local-echo
```

`local-smoke/graders/default.yaml`：

```yaml
name: default
checks:
  - checker: contains
    value: SMEVALS_READY
    required: true
```

`local-smoke/run-local`：

```sh
#!/usr/bin/env sh
set -eu
printf '%s\n' "$SMEVALS_PROMPT"
```

赋予 Runner 执行权限，再运行和查看报告：

```bash
chmod +x local-smoke/run-local
smevals run local-smoke -g
smevals report local-smoke
```

首条命令会生成一个 Run 和一个 Grade。
Runner 的 stdout 成为 `output.txt`，`contains` 命中后 Grade 为 `pass`，但分数仍是 `null`。
这项无分通过语义来自[M3]和[C3]，不是示例遗漏。

## 4. 核心数据流与对象关系

```text
Eval directory
├── Task ─┐
│         ├─ Runner(Task, Config/model) ─→ immutable Run
├── Config┘                                  │
│                                            ├─ Grader A ─→ Grade A
│                                            │   └─ Check 1 → Check 2 → ...
│                                            └─ Grader B ─→ Grade B
└── report / serve / build ←────────────── Runs + Grades
```

一次 `run` 先从文件名选择 Task 与 Config，再把 Task 内容和 model 交给 Runner。
Runner 是同步执行的无参数子进程，cwd 是新 Run 目录。
CLI 会保存 stdout、可选 stderr、其它 artifact 和 `run.yaml`。

一个成功 Run 可以接受多个 Grader。
每个 Grader 的 Checks 按 YAML 顺序同步执行，并共享该 Grade 的 cwd。
前一个 Checker 写的文件可被后一个 Checker 使用。

Grade 不改写 Run 主体，只写入 `grades/<grader>/`。
不同 Grader 各有自己的 Grade 子目录。
`--regrade` 会删除所选 Grader 的旧 Grade 子目录，再从 Run 重新判分。

report 把每个 Grade 展成一行，再按 `(config, model)` 分组。
数值 metric 取 mean 和 standard error，布尔 metric 取 true rate，tag 取出现次数与占比。
它是描述性汇总，不是新的 Grade，也不产生数据集级 pass/fail。

## 5. 完整 API catalog

### 5.1 公开面总览

| 作者面 | 载体 | 调用形状 | 返回或写入 | 同步性 | 依据 |
|---|---|---|---|---|---|
| Eval | 目录与 `eval.yaml` | `smevals <command> EVAL_PATH` | Run、Grade 或报告 | 同步 | M1、M5 |
| Task | `tasks/*.yaml` | 由 `run -t STEM` 选择 | 嵌入 `run.yaml` | 同步 | M1、C2 |
| Config | `configs/*.yaml` | 由 `run -c STEM` 选择 | model 与 Runner 进入 Run | 同步 | M1、C2 |
| Runner | 任意可执行文件 | 无参数，读 `SMEVALS_*` | stdout、stderr、文件、退出码 | 同步阻塞 | M2、C2 |
| Grader | `graders/*.yaml` | `grade -g STEM` | 一个 Grade | 同步 | M3、C3 |
| Check | Grader 的数组项 | 按数组顺序执行 | Check result | 同步串行 | M3、C3 |
| Checker | 内置名或可执行路径 | 无参数，读 `SMEVALS_*` | 退出码与可选 JSON | 同步阻塞 | M3、C3 |
| Grade | `grade.yaml` | 由 Grader 生成 | outcome、score、tags、checks | 派生事实 | M4、C3 |
| report | CLI | 读取一个 Grader 的 Grades | Markdown 或 JSON | 同步 | M5、C4 |

smevals 没有独立的 Scorer 或 Metric 对象。
Checker 同时承担 pass/fail 与可选 score，metric 只是 Check result 的具名 number 或 boolean。

### 5.2 Eval 与 Suite

官方最小 shape：

```yaml
# eval.yaml
name: string
description: string  # 可省略
```

| 字段或规则 | 参数、默认值与行为 | 失败语义 | 依据 |
|---|---|---|---|
| `eval.yaml` | 目录内存在该文件即被识别为 Eval | 缺少时，`run`、`grade`、`report` 报“not an Eval” | M1、C1 |
| `name` | 官方示例声明名称；report/site 缺少时回退到目录名 | 重名 slug 在多 Eval site 中报错 | M1、C4 |
| `description` | site 缺少时使用空字符串 | 不参与运行或判分 | H1 |
| Suite | 没有自身 YAML；缺少 `eval.yaml` 的目录会被 `serve/build` 递归搜索 | 找不到 Eval 时报错 | M5、C3 |

`run`、`grade` 和 `report` 只接收单个 Eval。
`serve` 与 `build` 接收一个或多个 Eval 或 Suite。
递归搜索遇到 Eval 后停止，不会继续进入它的 `runs/`。

### 5.3 Task

```yaml
# tasks/<selector>.yaml
name: string
prompt: string        # 可省略
any_scalar: string | number | boolean
any_structured: any   # 会存入 run.yaml，但没有完整 Task JSON 变量
```

| 字段或规则 | 参数、默认值与行为 | 失败或缺失语义 | 依据 |
|---|---|---|---|
| 文件选择 | `-t NAME` 匹配文件 stem，可重复；省略时按文件名排序执行全部 | stem 不存在时列出可用 Task | C2、T2 |
| `name` | 必填；决定 Run 路径、`SMEVALS_TASK` 和 report Task 名 | 源码直接索引，缺少时运行失败 | M1、C2 |
| `prompt` | 可省略；存在时设置 `SMEVALS_PROMPT` | 不存在时，该变量不会由 smevals 设置 | M2、T2 |
| 其它 scalar | 转为 `SMEVALS_TASK_<KEY>` 字符串 | list、object 和 null 不生成独立变量 | M2、C1 |
| 完整 Task | 整个 YAML mapping 嵌入 `run.yaml` | Checker 只收到 scalar 子集 | C2、C3 |

文件 stem 与 `name` 承担不同职责。
`-t` 选择 stem，Run 路径使用 Task 的 `name`。
作者应让两者相同，否则 CLI 选择名与报告名会分裂。

### 5.4 Config

```yaml
# configs/<selector>.yaml
name: string
runner: string
model: string
```

| 字段或规则 | 参数、默认值与行为 | 失败或缺失语义 | 依据 |
|---|---|---|---|
| 文件选择 | `-c NAME` 匹配 stem；默认 `default` | stem 不存在时列出可用 Config | M1、C2 |
| `runner` | 相对 Config 文件目录的可执行路径 | 不是可执行文件时，在任何模型调用前报错 | M1、C2 |
| `model` | 未给 `-m` 时使用；`-m` 可重复并完全替代它 | 两处都没有 model 时，源码直接索引失败 | M1、C2 |
| `name` | 官方示例提供；Run 中的 Config 名实际取文件 stem | YAML 内名称不参与选择 | M1、C2 |
| 其它字段 | 官方词汇允许描述更多设置 | 观察源码不传给 Runner，也不写入 Run | M1、C2 |

### 5.5 Runner 与 Run

Runner signature：

```text
executable() -> exit code
cwd = absolute Run directory
stdin = no documented contract
stdout -> output.txt
stderr -> stderr.txt when non-empty
other files -> Run artifacts
```

Runner 没有异步 callback，也没有并发 worker。
`subprocess.run()` 会等它退出；Task 与 model pair 也由 CLI 串行执行。
观察源码没有 timeout、自动 retry 或取消协议。

成功与失败都写入如下事实 shape：

```yaml
# run.yaml
task: {}                    # 完整 Task mapping
config:
  name: string              # Config 文件 stem
  runner: /absolute/path
  model: string             # 未 slugify 的精确 model
started: ISO-8601 UTC string
duration_seconds: number    # 四舍五入到 2 位
exit_code: integer
```

| 规则 | 默认值与返回 | 失败语义 | 依据 |
|---|---|---|---|
| 路径 | `runs/<task>/<config>/<model-slug>/<UTC timestamp>/` | 同秒重复追加 `-2`、`-3` | M4、C2、T2 |
| 完整标记 | `run.yaml` 最后写入 | 缺少它的目录不会被后续扫描 | M4、C2 |
| Runner exit 0 | 成功 Run，可被 grade | 模型答案很差也应 exit 0 | M2、C2 |
| Runner exit 非 0 | 失败 Run，仍保存 stdout、stderr 和 `run.yaml` | commit `0067c0d` 不 grade、不汇总、不计入 `-n` | M2、C2 |
| `--runs-dir DIR` | 外置目录使用 `<DIR>/<eval-slug>/` | 只适用于 `run/grade/report` | M4、M5 |

### 5.6 Grader 与 Check 配置

```yaml
# graders/<selector>.yaml
name: string
checks:
  - checker: string
    required: boolean       # 默认 false
    creates: string | list  # 可省略
    any_key: JSON-compatible YAML value
scoring:
  pass_threshold: number    # 可省略
```

| 字段 | 参数、默认值与行为 | 失败或跳过语义 | 依据 |
|---|---|---|---|
| Grader `name` | 写入 Grade 的 `grader` 字段 | 源码直接索引，缺少时判分失败 | C3 |
| `checks` | 有序 Check 数组 | 源码直接索引，缺少时判分失败 | M3、C3 |
| `scoring` | 整段可省略 | 没有阈值时，不按 score 建立门槛 | M3、C3 |
| `pass_threshold` | 与最后有效 score 做 `>=` 比较 | score 为 `null` 时不应用阈值 | M3、C3 |
| Check `checker` | 内置名，或相对 Grader 文件目录的可执行路径 | 不存在或不可执行时，该 Check 失败 | M3、C3 |
| `required` | 省略或 false 时，失败后继续 | true 且失败时，后续 Checks 写为 `skipped: true` | M3、C3 |
| `creates` | 单个文件名或列表；只在 Checker exit 0 后核对 | 任一文件缺少会把该 Check 改成失败 | M3、C3 |
| 其它 Check key | 完整写入 `SMEVALS_CHECK`；scalar 另生成独立变量 | core 不解释这些 key | M3、C3 |

`required: false` 不是“失败也算通过”。
它只决定失败后是否继续执行后续 Checks。
任何已执行 Check 的失败都会让 Grade outcome 成为 `fail`。

`-g` 选择 Grader 文件 stem，Grade 目录也使用该 stem。
`grade.yaml.grader` 则取 Grader YAML 的 `name`。
作者应让 stem 与 `name` 相同，避免目录身份与内容身份分裂。

### 5.7 全部内置 Checker

观察 commit 只有两个内置 Checker，没有隐藏 catalog。
完整注册表见[C3]。

| 名称 | Check signature | 输入查找 | 返回 | 默认值 | 失败与无分语义 |
|---|---|---|---|---|---|
| `contains` | `{checker: contains, value: string}` | 固定读取 Run 的 `output.txt` | 命中为 `ok: true` | 无 | Python literal、区分大小写的 substring；未命中为失败且无 score |
| `xml-valid` | `{checker: xml-valid, file: string}` | 先 Grade cwd，再 Run 目录 | well-formed XML 为 `ok: true` | 无 | 文件缺少或 XML parse error 为失败且无 score |

两者都是同步 Python 函数，不启动外部进程。
它们不产生 score、metric、tag 或 artifact。
只由这些 Checker 组成且全部通过的 Grade 会是 `pass` 加 `score: null`。

### 5.8 自定义 Checker 与 Check result

自定义 Checker signature：

```text
executable() -> exit code
cwd = grades/<grader>/
stdout = optional JSON object
stderr = diagnostics used on failure
```

stdout 的公开 JSON shape：

```json
{
  "score": 0.8,
  "metrics": {"cell_accuracy": 0.8, "structure_valid": true},
  "tags": ["partial_match"],
  "notes": "8/10 cells match",
  "details": {"mismatches": ["row 2, column 1"]}
}
```

| JSON key | 类型与默认 | core 处理 | 聚合 | 依据 |
|---|---|---|---|---|
| `score` | 文档要求 float 0.0–1.0；可省略 | 转成 float；`null` 等同省略 | Grade 取最后一个有效 score | M3、C1、C3 |
| `metrics` | object，value 应为 number 或 boolean | 非 object 被忽略 | number 为 mean ± stderr；boolean 为 true rate | M3、C1、C4 |
| `tags` | string list | 小写 snake_case、去重、排序 | Grade 取并集；report 取 count/share | M3、C1、C4 |
| `notes` | string；可省略 | truthy 值转 string | 不聚合 | M3、C1 |
| `details` | object；可省略 | 原样保留 | 不聚合 | M3、C1 |
| 未知 key | 任意 | 并入 `details` | 不聚合 | M3、C1、T1 |

Checker exit 0 表示 Check 通过，非 0 表示 Check 失败。
score 本身不会改变 Check 的 `ok`；它只参与 Grade 的 score 与 threshold。
若 stdout 不是 JSON，文本会进入 `details.output`，退出码仍决定 `ok`。
Checker 输出的 `ok`、`checker` 或 `skipped` 也会进入 `details`，不能替换 core 字段。

文档规定 score 在 0–1，观察源码却没有范围校验。
这是实现观察，不是允许作者输出越界分数的契约。
作者仍应严格限制到 0–1。

源码只检查 `metrics` 是否为 object，不验证每个 value。
非 number、非 boolean 的 value 可能在 report 转成 float 时失败。
作者应把 metric value 限制为官方协议声明的两种类型。

### 5.9 Grade shape、失败、skip 与无分

```yaml
# grade.yaml
grader: string
graded: ISO-8601 UTC string
outcome: pass | fail
score: number | null
tags: [string]
checks:
  - checker: string
    ok: boolean
    score: number        # 可省略
    metrics: {}          # 可省略
    tags: []             # 可省略
    notes: string        # 可省略
    details: {}          # 可省略
  - checker: string
    skipped: true
```

| 场景 | Check result | Grade score | Grade outcome | 后续 Checks | 依据 |
|---|---|---:|---|---|---|
| 所有 Checks 通过，最后一项有 score | `ok: true` | 最后一项 score | 由 threshold 决定；无阈值则 pass | 执行 | M3、C3 |
| 所有 Checks 通过，但都无 score | `ok: true` | `null` | pass，即使声明了 threshold | 执行 | M3、C3、T1 |
| Check 失败并输出 score | `ok: false` | 若无无分失败，则仍取最后 score | fail | 由 `required` 决定 | M3、C3、T1 |
| 任一 Check 失败且无 score | `ok: false` | `null` | fail | 由 `required` 决定 | M3、C3、T1 |
| `required: true` 的 Check 失败 | `ok: false` | 按上两行 | fail | 余项写 `skipped: true` | M3、C3、T1 |
| `required: false` 的 Check 失败 | `ok: false` | 按上两行 | fail | 继续 | C3、T1 |
| exit 0 但 `creates` 缺文件 | `ok: false` 与说明 | 通常为 `null` | fail | 由 `required` 决定 | M3、C3、T1 |
| score 等于 threshold | `ok: true` | 该 score | pass | 执行 | C3、T1 |

smevals 没有 `unavailable`、`errored` 或 Checker 主动 skip 状态。
基础设施失败只存在于 Runner 层；Checker 崩溃通常会表现为失败 Check。
skip 只能由先前的 required failure 触发。

### 5.10 完整子进程变量协议

Runner 和 Checker 都继承调用 `smevals` 时的进程变量集合。
下面只列 core 新增或替换的变量。

#### Runner 变量

| 变量 | 何时存在 | 值 | 依据 |
|---|---|---|---|
| `SMEVALS_MODEL` | 总是 | Config model 或 `-m` 传入的精确字符串 | M2、C2 |
| `SMEVALS_TASK` | 总是 | Task 的 `name` | M2、C2 |
| `SMEVALS_PROMPT` | Task 有 `prompt` 时 | prompt 原文 | M2、C2、T2 |
| `SMEVALS_TASK_<KEY>` | 每个 scalar Task key | `str(value)` | M2、C1 |
| `SMEVALS_RUN_DIR` | 总是 | Run 目录绝对路径 | M2、C2 |

#### Checker 变量

| 变量 | 何时存在 | 值 | 依据 |
|---|---|---|---|
| `SMEVALS_RUN_DIR` | 总是 | 被判分 Run 的绝对路径 | M3、C3 |
| `SMEVALS_CHECK` | 总是 | 完整 Check mapping 的 JSON | M3、C3 |
| `SMEVALS_CHECK_<KEY>` | 每个 scalar Check key | `str(value)` | M3、C1、C3 |
| `SMEVALS_TASK` | Run 含 Task 名时 | Task 的 `name` | M3、C3 |
| `SMEVALS_TASK_<KEY>` | Run 含完整 Task mapping 时 | 每个 scalar Task key 的 `str(value)` | M3、C1、C3 |

`<KEY>` 会把连续非字母数字字符变成 `_`，再转大写。
例如 `expected-answer` 变成 `EXPECTED_ANSWER`。
不同原始 key 可能折成同一个变量名，作者应避免这种碰撞。

scalar 一律使用 Python `str()`。
例如 YAML `true` 进入独立变量后是 `True`，不是 JSON 的 `true`。

list、object 与 null 不会生成独立变量。
Checker 可从 `SMEVALS_CHECK` 读取结构化 Check 配置，但 Runner 没有对应的完整 Task 或 Config JSON。
Checker 也没有专用 `SMEVALS_PROMPT`；Task prompt 会作为 `SMEVALS_TASK_PROMPT` 出现。
`creates` 是 list 时也没有 `SMEVALS_CHECK_CREATES`，Checker 应从完整 JSON 读取它。

### 5.11 全部 CLI

全局只有 `--help` 与 `--version`，主命令有六个子命令。
下表包含观察 commit 的全部参数和默认值，依据为[M5]与对应 Click 声明。

| 命令 | 完整 signature | 默认值与重复参数 | 正常输出 | 非 0 退出 |
|---|---|---|---|---|
| `run` | `run EVAL [-m MODEL]... [-c CONFIG] [-t TASK]... [-n N] [-g [GRADER]] [--runs-dir DIR]` | Config=`default`；无 `-m` 用 Config model；无 `-t` 用全部；无 `-n` 每 pair 新跑一次；bare `-g` 用 `default` | Run 目录；可即时 Grade | 任一 Runner 失败，或任一即时 Grade 为 fail |
| `grade` | `grade EVAL [-g GRADER] [--regrade] [--runs-dir DIR]` | Grader=`default`；默认只处理未有该 Grade 的成功 Run | Grade 与 skip/旧 spec 摘要 | 本次新生成的任一 Grade 为 fail |
| `report` | `report EVAL [-g GRADER] [--by-task] [--json] [--runs-dir DIR]` | Grader=`default`；默认 Markdown | 排名、score、metric、tag；或 JSON rows | Eval、Grader 或 Grade 缺失；Grade fail 本身不使它失败 |
| `serve` | `serve EVAL_OR_SUITE... [-g GRADER] [--host HOST] [-p PORT]` | Grader=`default`；host=`127.0.0.1`；port=`7001` | 阻塞的 live web server | 输入或 server 错误 |
| `build` | `build EVAL_OR_SUITE... [-g GRADER] [-o DIR]` | Grader=`default`；output=`build/` | 自包含静态 site | 输入或文件错误 |
| `docs` | `docs` | 无参数 | 安装包内的 README 文本 | 包元数据读取错误 |

每个子命令还自动支持 `--help`。
除持续阻塞的 `serve` 外，其余命令完成工作后返回；没有异步作者 API。

`-m` 和 `-t` 都可重复。
`-n` 只接受 1 以上整数，并把每个 Task/model pair 补到 N 个成功 Run。
它按完整 pair pass 轮转，减少中断时样本数量失衡。

`run -n N -g` 只给本次新 Run 判分，不会补判旧的未判分 Run。
达到 N 个成功 Run 后，该命令不会创建 Run，也不会给旧 Run 补 Grade。
需要补判时应另跑 `grade`。

`serve` 与 `build` 没有 `--runs-dir`。
它们只从各 Eval 的内部 `runs/` 读取数据。
外置 Run 目录只能由 `run`、`grade` 和 `report` 使用。

## 6. 可抄的完整场景

这一节优先复用固定 commit 中的完整官方目录。
这样既保留可执行权限和脚本细节，也避免把相似但不存在的 API 写进示例。

先取固定快照：

```bash
git clone https://github.com/prime-radiant-inc/smevals.git smevals-upstream
git -C smevals-upstream checkout \
  0067c0da2f28f534f9daf1ef4c37181450ddfa28
```

官方 Runner 和 Judge 示例使用 Simon Willison 的 [`llm`](https://llm.datasette.io/) CLI。
先让 `llm` 能独立调用示例中的 model，再执行涉及模型的命令。
模型 key、插件和费用都属于 `llm` 与对应 Provider，不是 smevals 的配置面。

### 场景 A：确定性 Markdown table 检查与 metric 聚合

复制完整官方 Eval：

```bash
cp -R smevals-upstream/examples/markdown-tables ./markdown-tables
smevals run markdown-tables -g
smevals report markdown-tables --by-task
```

这个目录含三项 Task、一个 Config、Runner、Grader 和完整 `table-check`。
Task 除 `prompt` 外还带 `csv`，Checker 通过 `SMEVALS_TASK_CSV` 取得期望表格。
全部文件可在[E2]逐项核对。

Grader 本身很小：

```yaml
name: default
checks:
  - checker: ../checkers/table-check
    required: true
scoring:
  pass_threshold: 1.0
```

[`table-check`](https://github.com/prime-radiant-inc/smevals/blob/0067c0da2f28f534f9daf1ef4c37181450ddfa28/examples/markdown-tables/checkers/table-check)用 Python 标准库读取 CSV 和 Markdown table。
它返回 `cell_accuracy`、`structure_valid`、tags、notes 和 0–1 score。
只有结构正确且每个 cell 相等时才 exit 0。

要观察多个 Run 的聚合，可在理解模型费用后执行：

```bash
smevals run markdown-tables -n 3 -g
smevals report markdown-tables --by-task
smevals report markdown-tables --json > markdown-table-grades.json
```

`-n 3` 是 commit `0067c0d` 的能力，不属于 PyPI 0.2.0。
report 会按 Config/model 显示 score 的 mean ± stderr，并把布尔 metric 显示为 true rate。

### 场景 B：同一 Run 先做快检查，再用开放 Judge regrade

复制完整 haiku Eval：

```bash
cp -R smevals-upstream/examples/haiku ./haiku
smevals run haiku -g default
smevals grade haiku -g judge
smevals report haiku -g judge
```

第一步用确定性的 `haiku-structure` 判定三行结构。
第二步不再调用生成模型，而是给同一批成功 Run 增加 `judge` Grade。
两个 Grader 的结果分别保存在 `grades/default/` 与 `grades/judge/`。

官方 `graders/judge.yaml` 的完整 shape 是：

```yaml
name: judge
checks:
  - checker: ../checkers/haiku-structure
    required: true

  - checker: ../checkers/llm-judge
    model: openai-codex/gpt-5.6-terra
    tags:
      - nature_imagery
      - seasonal_reference
      - correct_syllable_structure
      - surprising_turn
      - cliche
      - mentions_the_topic
    rubric: >-
      Score this haiku from 0 to 10. Award up to 4 points for vivid,
      concrete imagery; up to 3 points for following the 5-7-5 syllable
      structure; and up to 3 points for overall effect - a haiku that
      lands a surprising or resonant final line deserves them. Apply
      every tag from the allowed list that is true of the haiku.

scoring:
  pass_threshold: 0.5
```

完整 [`llm-judge` Checker](https://github.com/prime-radiant-inc/smevals/blob/0067c0da2f28f534f9daf1ef4c37181450ddfa28/examples/haiku/checkers/llm-judge)做四件事：

1. 从 `SMEVALS_RUN_DIR/output.txt` 读取 haiku。
2. 用 Check 的 tag 列表构造严格 JSON Schema。
3. 把 rubric 与 haiku 交给 `llm --schema`。
4. 把 0–10 分除以 10，并返回 tags、notes 与 `details.raw_score`。

若示例 model 不在本机 `llm models` 中，可把 Check 的 `model` 改为可用且支持结构化输出的 model。
这只是 Checker 自定义配置，不改变 smevals 协议。
Judge 调用可能收费，也可能波动；本文没有执行该付费步骤。

结构 Check 是 required。
它失败时，Judge 写为 skipped，避免为明显不合格的文本付费。
这正是 smevals 中 ordered checks 的主要工作流价值。

### 场景 C：提取、校验、渲染、视觉 Judge 的 ordered pipeline

复制完整 SVG Eval：

```bash
cp -R \
  smevals-upstream/examples/pelican-riding-a-bicycle \
  ./pelican-riding-a-bicycle
smevals run pelican-riding-a-bicycle -g
smevals serve pelican-riding-a-bicycle
```

它还要求 `rsvg-convert`，并要求 `llm` 能调用 Grader 中的视觉 model。
仓库没有固定 `rsvg-convert` 的安装版本，因此执行前应在自己的系统中单独验证该命令。

完整 Grader 如下：

```yaml
name: default
checks:
  - checker: ../checkers/extract-svg
    creates: extracted.svg
    required: true

  - checker: xml-valid
    file: extracted.svg
    required: true

  - checker: ../checkers/render-svg
    input: extracted.svg
    creates: render.png
    required: true

  - checker: ../checkers/llm-judge-image
    image: render.png
    model: openai-codex/gpt-5.6-sol
    tags:
      - recognizable_pelican
      - recognizable_bicycle
      - pelican_riding_bicycle
      - feet_on_pedals
      - wings_on_handlebars
      - correct_bicycle_frame_shape
      - facing_right_to_left
      - facing_left_to_right
      - wearing_a_hat
      - no_pelican_visible
      - no_bicycle_visible
    rubric: >-
      Score this image from 0 to 10. Award up to 3 points for containing
      a recognizable pelican, up to 3 points for a recognizable bicycle,
      up to 2 points for the pelican plausibly riding the bicycle, and
      up to 2 points for overall composition and charm.

scoring:
  pass_threshold: 0.5
```

`extract-svg` 写 `extracted.svg`，core 核对 `creates`。
`xml-valid` 优先从共享 Grade cwd 读取该文件。
`render-svg` 再写 `render.png`，最后的 Judge 读取图像并给分。

任一步 required failure 都会停止后续步骤。
`extracted.svg`、`render.png` 和 `judge-log.json` 会与 Grade 一起保存，可从 web UI 打开。
这套流程来自完整官方[E3]示例。

## 7. 结果、诊断、artifact、CI 与 regrade

### 文件 shape 与诊断入口

```text
runs/<task>/<config>/<model-slug>/<timestamp>/
├── run.yaml
├── output.txt
├── stderr.txt                 # Runner 有 stderr 时
├── <runner artifacts...>
└── grades/
    ├── default/
    │   ├── grade.yaml
    │   ├── grader.yaml
    │   └── <checker artifacts...>
    └── judge/
        ├── grade.yaml
        ├── grader.yaml
        └── <checker artifacts...>
```

Runner 问题先看 `run.yaml.exit_code` 与 `stderr.txt`。
判分问题先看 `grade.yaml.checks`，其中有 `ok`、`skipped`、notes、details、metric 和 tag。
`grader.yaml` 是产生该 Grade 时的字节级 Grader 快照。

Checker 的非 JSON stdout 不会丢失，而是进入 `details.output`。
失败 Checker 的 stderr 在没有既有 notes 时成为 notes。
成功 Checker 的 stderr 不进入 Grade；需要保留时，应由 Checker 自己写 artifact。

### report 的精确聚合

report 先排除失败 Run，再排除没有所选 Grade 的 Run。
旧 Grader spec 产生的 Grade 仍会进入结果，但 header 会发出提示。

| 数据 | report 行为 | 空值行为 | 依据 |
|---|---|---|---|
| Grade score | 按 `(config, model)` 取 mean；两项以上显示 sample stderr | `null` 不进入 mean；全空显示 `-` | C4、T3 |
| Grade outcome | 统计 fail 数 | 不参与 score mean | C4、T3 |
| numeric metric | 同组取 mean ± stderr | 缺该 key 的行不进入该 metric | C4、T3 |
| boolean metric | 同组取 true rate | 缺该 key 的行不进入分母 | C4、T3 |
| tags | 全局 count/share；model 内显示 share | tag 缺失表示未观察到，不表示 false | M3、C4 |
| 同名 metric | 单个 Grade 行内，后执行 Check 的值替换先前值 | 没有冲突说明 | C4 |

`--by-task` 在每个 model block 增加 Task score。
`--json` 返回 eval、grader、7 位 grader version、排除的失败 Run 数和 raw rows。
每行含 Task、Config、model、outcome、score、tags、合并后的 metrics 与 Run 路径。

### web 与静态 site

`serve` 每次轮询都重新读取磁盘，适合观察正在写入的 Run 和 Grade。
`build` 生成同 shape 的静态 site，并把整个内部 `runs/` 树复制进去。
多次 build 会刷新指定 Eval，同时保留输出目录中的其它 Eval。

两条命令都会载入 Eval 中的全部 Grader 与 Grade。
`-g` 只指定页面初始选择的 Grader；名称不存在时，源码回退到按文件名排序的第一项。

这也带来资料暴露风险。
Runner log、prompt、Checker details 和其它文件可能含敏感内容，发布静态 site 前必须审阅复制进去的文件。
smevals 没有自动脱敏协议。

### CI 退出码不是数据集门槛

| CI 调用 | 会让命令非 0 的判分状态 | 不会让命令非 0 的状态 | 依据 |
|---|---|---|---|
| `run EVAL -g` | 本次任一 Runner 失败；本次任一 Grade fail | 之前的失败 Grade | M5、C2 |
| `grade EVAL` | 本次新生成的任一 Grade fail | 已存在而被 skip 的失败 Grade；旧 spec 提示 | C3 |
| `grade EVAL --regrade` | 重新生成的任一 Grade fail | 失败 Run 会被跳过 | C3 |
| `report EVAL` | 所选 Grader 缺失，或没有对应 Grade | 报告内存在 Grade fail | C4 |
| `report EVAL --json` | 所选 Grader 缺失，或没有对应 Grade | 任何聚合数值未达自定义门槛 | C4 |

因此，fresh CI 可以用 `run -g` 检查本次样本。
已有 Run 的 CI 若要重新核对全部 Checker，可显式用 `grade --regrade`。
只执行不带 regrade 的 `grade`，不能证明旧 Grade 全部通过。

smevals 没有 pass-rate、平均分或置信区间准入选项。
需要数据集级条件时，应读取 `report --json`，由 CI 中的独立步骤计算并返回退出码。
这一步属于项目自定义策略，不是 smevals Grade。

### regrade 的精确行为

默认 `grade` 分三类处理：

1. 没有所选 Grade 的成功 Run 会被判分。
2. Grader YAML 语义相同的 Grade 会被 skip。
3. Grader YAML 语义不同的 Grade 会被标为旧 spec，但不会自动改写。

语义比较会读取 YAML，因此注释或格式变化不算旧 spec。
Grade 内保存的 `grader.yaml` 仍是原文件的字节级副本。

report 显示的 7 位 grader version 则是现用 Grader 原始字节的 SHA-256 前缀。
格式变化可能改变这个显示值，同时仍被语义比较视为 up-to-date。

`--regrade` 会删除每个成功 Run 下所选 `grades/<grader>/`，再创建新的 Grade。
旧 `grade.yaml`、`grader.yaml` 和该目录全部 artifact 都会消失。
其它 Grader 的目录不受影响，Run 主体也不受影响。

Judge regrade 会再次调用 Judge，可能产生费用和不同分数。
在批量执行前，应先用单个小 Eval 核对 rubric、model、artifact 和费用。

## 8. 自定义扩展

### 自定义 Runner

Runner 可用 shell、Python、Node 或其它语言。
下面的模板符合[M2]协议：

```sh
#!/usr/bin/env sh
set -eu

# 调用任意 model 或 Agent harness。
response="$(my-agent --model "$SMEVALS_MODEL" --prompt "$SMEVALS_PROMPT")"
printf '%s\n' "$response"

# 可选：把 trace、token 统计或 harness log 写进当前 Run 目录。
```

只有基础设施问题才应 exit 非 0。
模型给出低质量答案时，Runner 仍应打印答案并 exit 0，让 Grader 判断质量。
否则 commit `0067c0d` 会把它排除在 grade、report 和 `-n` 目标之外。

Runner 会继承调用方的进程变量集合。
它没有 smevals 提供的 secret scope、网络限制、文件限制或超时。
这些责任留给 Runner 与外层执行系统。

### 自定义 Checker

下面是一个可直接执行的确定性 Checker。
它读取 `output.txt`，用 Check 的 `expected` 配置判定，并返回 score、metric、notes 与 details。

```python
#!/usr/bin/env python3
import json
import os
import pathlib
import sys

run_dir = pathlib.Path(os.environ["SMEVALS_RUN_DIR"])
output = (run_dir / "output.txt").read_text()
check = json.loads(os.environ["SMEVALS_CHECK"])
expected = check["expected"]
matched = expected in output

print(json.dumps({
    "score": 1.0 if matched else 0.0,
    "metrics": {"expected_present": matched},
    "notes": f"expected token {expected!r}",
    "details": {"output_length": len(output)},
}))
sys.exit(0 if matched else 1)
```

对应 Check：

```yaml
- checker: ../checkers/expected-token
  expected: READY
  required: true
```

别忘记赋予执行权限：

```bash
chmod +x checkers/expected-token
```

### 用 artifact 连接多个 Checker

Grader 不会把先前 Check result JSON 传给后一个 Checker。
后续 Checker 只能直接读取 Run，或读取共享 Grade cwd 中的文件。

需要多阶段算法时，可让前一项写中间 JSON、图片或提取文本，并用 `creates` 声明文件。
后一项再读取该文件并返回最终 score。
官方[E3]的 SVG pipeline 就是这一形状。

### 自定义聚合的边界

Grade 内没有 weights、sum、mean 或公式 DSL。
最后一个有 score 的 Check 决定 Grade score。

若确实需要复合分数，最后一个 Checker 可读取前面显式写出的中间 artifact，再计算一个 0–1 score。
core 不会替作者保存前面 Check result 的输入通道，因此中间资料必须由 Checker 自己定义。

数据集级聚合只能通过 `report --json` 后处理。
项目可以为 CI 写一个独立命令，但不能把它误称为内置 Grader 能力。

## 9. 好在哪里

以下是研究判断。

### 协议小，而且语言中立

Runner 与 Checker 都是无参数可执行文件。
作者只需理解 cwd、`SMEVALS_*`、stdout、stderr、退出码和文件，不必绑定 Python 类体系。
一个 shell 检查可以和 Python Judge 放在同一 Grader 中。

### YAML 顺序同时表达成本与依赖

```yaml
- checker: ../checkers/extract-svg
  creates: extracted.svg
  required: true
- checker: xml-valid
  file: extracted.svg
  required: true
- checker: ../checkers/llm-judge-image
```

这段语法直接表达“先提取，再做廉价校验，最后付费 Judge”。
`required` 与 `creates` 让依赖和失败停止点紧邻调用处。

### Run 与 Grade 分离适合 regrade

生成模型只运行一次，同一 Run 可接受多个 Grader。
修改 rubric 后可以只重跑 Judge，不必再次生成答案。
`grader.yaml` 快照还能说明每个 Grade 使用了哪份 spec。

### 无分失败不会借用旧 score

若早期 Check 给过分，后续 Check 又失败且没有 score，Grade 会明确写 `score: null`。
这比保留旧 score 更诚实，因为旧分数没有代表未完成的判分步骤。

### 失败 Run 与低质量答案分层

commit `0067c0d` 把 Runner 非 0 解释为 harness 失败，并从 grade/report 中排除。
作者可以保留错误现场，又不会把网络故障算成模型零分。

### artifact 是一等协作面

Checker 可以留下渲染图、Judge log 和结构化诊断。
后续 Check、live UI 与静态 site 都能复用这些文件。
对多模态和代码执行 eval，这比只返回一个 float 更有诊断价值。

## 10. 不好的地方与不应类比 NiceEval 的边界

以下“好或不好”是研究判断；API 行为仍以第 5 节的一手材料为准。

### 内置断言面非常窄

内置只有 literal `contains` 与 well-formed `xml-valid`。
regex、JSON Schema、exact match、数值误差、集合、工具调用与 Judge 都要写脚本。
协议虽然小，常见 matcher 仍会散落成大量可执行文件。

### `required` 名称容易让人误判

它只表示失败后停止，不表示“不 required 就可忽略失败”。
非 required Check 失败仍让整个 Grade fail。
这一语义适合 pipeline，却不等于 NiceEval 的 optional、Severity 或 points。

### “最后 score 获胜”不是通用聚合

多个 Check score 不会相加、求平均或按权重组合。
早期 score 只是可能被后项替代的中间值。
YAML 调整顺序可能改变 Grade score，即使每个 Checker 本身没有变化。

### threshold 对无分通过不起作用

全部 Check exit 0、但没有任何 score 时，Grade 会 pass。
即使 Grader 声明了 `pass_threshold`，结果仍是 pass 加 `score: null`。
作者不能把“有 threshold”当成“必定有分”的校验。

### 没有 schema-first 作者反馈

YAML 没有官方 JSON Schema，也没有 `validate` 或 dry-run 子命令。
缺字段、错类型、score 越界和变量名碰撞多在执行期暴露。
`smevals studio` 只存在于非 main 的 WIP branch，不属于本文快照。

### Config 介绍超过了数据通道

官方词汇说 Config 可含参数、system prompt 和 tools。
观察 commit 没有把这些字段传给 Runner。
不能把任意 Config YAML 当成已经接通的 typed experiment configuration。

### 子进程边界不等于安全隔离

Runner 和 Checker 继承调用方的变量，并拥有宿主文件权限。
Checker 可读取 Run，也能在权限允许时改写它；“Run immutable”是工作流约定，不是强制文件防护。
core 也没有 timeout、网络规则、secret 筛选或并发上限。

### Judge runtime 全由作者脚本承担

官方 Judge Checker 自己定义 prompt 拼接、JSON Schema、model 调用、错误处理和 score 归一化。
这适合逃生口，却会让不同 Eval 复制关键 Judge 逻辑。
它不能直接类比 NiceEval 的统一 Judge runtime 与 `unavailable` 语义。

### outcome 太少

Grade 只有 `pass|fail`，另加 `score: null`。
它不能区分证据不足、Judge 不可用、Checker 编程错误与被测答案不合格。
Runner failure 又位于另一层，报告作者需要自行理解两种失败。

### report 是描述面，不是准入面

mean、stderr、boolean rate 与 tag share 很有用，但没有 aggregate gate。
report 中有失败 Grade 也不改变命令退出码。
它不应类比 NiceEval 题内 Verdict 或实验层停止条件。

### 与 NiceEval 对象不能逐字对齐

| smevals 概念 | 不能直接类比的原因 |
|---|---|
| Check | 它是 post-run process step，不是带 scope、evidence locator 与完整度的 Assertion |
| `required` | 它控制后续执行，不是 Severity、optional 或 points |
| Grade outcome | 只有 pass/fail，不是 NiceEval 四态 Verdict |
| `score: null` | 只表示没有可用 score，不携带 `unavailable` 原因 |
| Runner | 任意可执行协议，不是标准 Adapter 或 Sandbox owner |
| report mean | 描述多个 Grade，不产生 Aggregate Gate |
| Grade artifact | 是共享 cwd 文件，不自动成为 typed evidence |

## 11. 对 NiceEval 可吸收与不应复制

### 可吸收

1. **保留“小进程协议”逃生口。** 任意语言 Checker 很适合项目特有编译器、渲染器和静态分析器。
2. **把昂贵生成与 regrade 分开。** 不可变 Run 配合多个具名 Grade，能安全比较 rubric 与 Judge。
3. **让有序依赖显式声明 artifact。** `creates` 比依赖脚本之间的隐式文件约定更容易诊断。
4. **无分失败必须使总分不可用。** 后续判分缺失时，不应让早期分数冒充完整结果。
5. **把 harness failure 与低质量答案分开。** 非零 Runner 退出码不应自动成为模型零分。
6. **保存判分 spec 快照。** 每个结果都应能回到产生它的规则版本。
7. **metric、tag、notes 与 details 分工清楚。** 可聚合数值、人类说明和结构化诊断不应挤进一个字符串。

### 不应复制

1. **不采用“最后 score 获胜”。** NiceEval 应让每条 AssertionResult 有稳定身份，再由 points 与 Verdict 规则组合。
2. **不让 `required` 同时承担停止和必要性暗示。** 控制流、严重度与计分应是不同字段。
3. **不让 YAML 任意 key 替代 typed authoring。** 常用事实应有 TypeScript 补全和穷尽检查。
4. **不把 Judge runtime 复制到每个脚本。** prompt 定界、输出解码、重试和不可用原因应统一。
5. **不把 `score: null` 当成完整可用性模型。** 还需要具名原因、证据完整度和可导航 locator。
6. **不让外部进程继承所有 secret 成为默认。** escape hatch 应有最小权限、超时和敏感资料策略。
7. **不把描述性 report 当成 Verdict。** 样本判定、题内组合和实验聚合应保持分层。

## 12. 无法核实项

下列项目没有 main、发布文档或 API reference 的一手承诺，因此本文不作肯定陈述：

- commit `0067c0d` 会以哪个版本发布，以及 `-n` 与失败 Run 语义是否保持不变；
- YAML 文件、Run 与 Grade 是否会获得正式 schema 和兼容策略；
- Config 中 model 参数、system prompt、tools 这三类字段计划通过什么通道到达 Runner；
- [`reusable-runners`](https://github.com/prime-radiant-inc/smevals/tree/45676afdc07eb1c9ad6290a519c2c323f0861a68) branch 会否进入 main，以及会采用什么公开 shape；
- [`wip/studio`](https://github.com/prime-radiant-inc/smevals/tree/57e1daa4f33235eff34cbbd414b25491786c4e0c) branch 的 studio、schema 与写 API 会否成为产品能力；
- Runner 或 Checker 是否计划增加 timeout、并发、隔离、取消与 secret 筛选；
- Judge 示例所用 model ID、插件、费用与可用性是否对所有用户成立；
- report 是否会增加 pass-rate、平均分或统计条件的 CI gate；
- 静态 site 的敏感资料审阅、脱敏和发布安全是否会形成正式协议。

本次没有执行付费生成或 Judge 调用。
安装固定 commit、读取六个 CLI help、运行官方测试 88 项，以及核对 PyPI 文件摘要都成功。
这些检查只能证明观察快照，不构成未来兼容承诺。
