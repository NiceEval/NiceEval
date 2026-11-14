# 读结果的命令：对象寻址代替 query 与投影 flag

## 要决定什么

读结果现在有三套语法：`show` 的投影 flag、`query run` 的 JSON request、`view` 的 selector。
`show` 每加一类事实就多一个互斥 flag（`--diff --change`、`--artifacts --artifact`、`--assertions --entry --image`、`--execution --expand`），读者要记住哪个 flag 搭配哪种 ID。
`query` 与 `show --json` 输出同一批 document，却要求手写 JSON；`discover` 只列 operation 名字，agent 照着随包指引找不到写 request 的方法。

用户决定不保留旧语法的兼容。本设计决定读结果的 CLI 语法、机器输出怎样自带下一步，以及 `query` 的去留。

非目标：

- 不改变固定 Inspection operation、它们的 result 形状、`PublicationCutoff` 与 selection 语义。
- 不改变已保存的 Record；旧 Record 照常可读。
- 不改变 `niceeval exp` 的 receipt 与 `niceeval invocation` 命令。

## 方案

### 语法

```text
niceeval show [<对象>...] [<方面>] [<ID>] [--json] [--explain] [--all] [--continuation <token>] [方面专属 flag]
niceeval compare <run>... -- <run>... [--mode paired|side-by-side|exact] [--max-regressions <n>] [--json]
niceeval view [<对象>] [<方面>] [<ID>]
```

对象带类型前缀，输出里怎样打印就怎样接受：

| 对象 | 写法 | operation |
| --- | --- | --- |
| 当前结果 | 省略 | `project.get` |
| Attempt | `@<locator>` | `attempt.get` 与 `attempt.usage` |
| Experiment | `exp:<experiment-id>`，可重复 | `experiment.get` |
| Run | `run:<run-id>`，可重复 | `run.get` |
| Run 列表 | `runs` | `run.list` |
| 外部 Record | 任一对象加 `--record <file>` | 同上，读取该文件 |

Attempt 的方面：

| 方面 | operation | ID 前缀（可省略方面词） |
| --- | --- | --- |
| `assertions` | `attempt.assertion.detail`（列表） | `ae_` → 单条断言 |
| `source` | `attempt.sources` | — |
| `execution` | `attempt.trace` | `tool_`、`command_`、`item_`、`turn_`、`evt_` 等 trace 稳定 ID → `attempt.trace.detail` |
| `timing` | `attempt.timing` | — |
| `usage` | `attempt.usage`；加 `--reprice <file>` 为 `attempt.reprice` | — |
| `diff` | `attempt.diff` | `fc_` → 带 `changeId` 的 `attempt.diff`，显示 unified diff |
| `artifacts` | `attempt.artifacts` | 产物 ID → `attempt.artifact` |

Experiment 的方面只有 `assertions`（判据矩阵，可带多个 `exp:` 与 `--eval <prefix>`）。
断言图片写作 `show @<locator> ae_<id> image <image-id> --output <file>`，只写文件，不向终端输出二进制。

ID 前缀与方面的对应关系由 Inspection 拥有的一张表决定。给出方面词且与 ID 前缀不符、或 ID 前缀不在表中时，命令失败并列出该对象可用的方面。
`--actor`、`--type` 只与 `execution` 同用，`--reprice` 只与 `usage` 同用，`--eval` 只与 Experiment 的 `assertions` 同用；其它组合是 argv 错误。

比较两组 Run 不是“看一个对象”，因此是独立动词 `compare`，左右两组用 `--` 分开。

### 每个输出都给出下一步

文本输出末尾的 `Next` 打印完整可粘贴的命令，例如 `niceeval show @1RSAXZ5EHJH2V fc_3f90…`。
`--json` 的每个 document 增加 `links`：`{ rel, command }` 的数组，`command` 与文本 `Next` 相同。
`rel` 是闭合枚举（`assertion`、`diff`、`file-change`、`execution`、`execution-item`、`timing`、`usage`、`source`、`artifact`、`run`、`attempt`、`experiment`、`next-page`），agent 可以按 `rel` 选择而不解析命令文本。
`links` 只列出这一份 result 已经暴露的稳定 ID，有界，不为了列链接额外读取事实。

agent 读结果只需要知道入口 `niceeval show --json`，之后顺着 `links` 下钻；不再需要 operation 目录或 request schema。

### 删除 query

- 删除 `niceeval query` 及其 `discover`、`explain`、`run`。
- `explain` 的作用（这次读取会读哪些事实、selection 是什么）改为 `show … --explain`：对同一对象与方面输出 explanation document，不读取重 payload。
- 机器 document 的协议 ID 由 `niceeval.query/v3` 改为 `niceeval.inspection/v1`；`outcome` 为 `success | explanation | failure`，不再有 `discovery`。
- Testkit 与 E2E 通过 `show --json` 或库内的 `selectInspectionOperation` 取得 document，不经 CLI JSON request。
- `show --json` 仍为每个 operation 写一行 document，行顺序按上面的表；document 内容与库内 operation 结果同一编码。

### 指引

随包 INDEX、`init` 写入的项目指引、INIT 与公开教程只介绍 `show`、`show --json` 与 `view`。项目指引第 3 条写作：读结果用包管理器调用的 `niceeval show`（脚本与 agent 加 `--json`，顺着输出的 `links` 下钻）与 `view`。

## 取舍

| 做法 | 优点 | 代价 | 判断 |
| --- | --- | --- | --- |
| A：对象寻址 + `links`（本方案） | 一条规则；输出即输入；agent 无需目录 | 一次性改掉全部 flag 与 query | 采用 |
| B：保留 flag，只删 query | 改动小 | flag 继续随事实增多；ID 与 flag 的搭配仍要记 | 不采用 |
| C：保留 query，给 discover 加 schema | agent 能写 request | 两套语法并存；手写 JSON 本身就是 DX 负担 | 不采用 |

## 验收

- 每个固定 operation 都能用一条 `show` 命令到达；文本 `Next` 与 JSON `links` 中的每条命令原样执行都成功。
- 省略方面词时，`ae_`、`fc_`、trace 稳定 ID 与产物 ID 分别路由到正确 operation；方面词与 ID 冲突时报错并列出可用方面。
- 从 `niceeval show --json` 出发，只跟随 `links`，能到达一个失败 Attempt 的失败断言详情、相关命令输出与改动文件 diff。
- `show … --explain` 输出 explanation document，不读取重 payload。
- `niceeval query` 不存在；协议 ID 为 `niceeval.inspection/v1`；随包指引与教程不出现 `query`。
- `view` 接受同样的对象、方面与 ID，打开对应位置。
