# Record —— `.niceeval/` 运行记录

Record 是实验跑过之后留在磁盘上的记录:每条判定,以及支撑这条判定的全部证据。
默认记录根是项目下的 `.niceeval/`;`niceeval exp` 写入它,`niceeval show`、`niceeval view` 和 `niceeval/report` 读取它。

```text
.niceeval/
└── <experiment>/
    └── <run>/
        ├── run.json
        └── <eval-id>/a0/
            ├── result.json
            ├── events.json
            ├── sources.json
            ├── trace.json
            ├── o11y.json
            └── diff.json
```

「记录」指持久化事实,不指终端输出或网页报告。
判定、结构化执行错误、去重后的 diagnostics 与轻量摘要在 JSON 主记录中;瞬时 progress 不落盘;体积较大、按需读取的对话、源码、trace 和 diff 拆成 attempt artifact。
完整字段、可选文件和版本规则见 [Architecture](architecture.md)。

用户通常不需要手工拼路径:用 [`niceeval/record`](library.md) 打开记录根、按层次导航、读取 attempt artifact,或把一组 Run 发布到别的目录。

## 三层里的第一层

从磁盘到一张报告经过[三层](../reading/README.md):事实、选择、呈现。
Record 是最下面那层,**只回答「盘上有什么」,不回答「该看哪些」**。
「每个实验取最新一次」是一种看法,「这批数据覆盖了多少题」是一次推断——两者都住在 Sample 层。
这条线让 Record 保持一个性质:它的每个返回值都能在磁盘上逐字节指出来源,读者不需要判断哪些是事实、哪些是解释。

## 它负责什么

`niceeval/record` 拥有:

- **格式与版本:** 哪些文件存在、字段怎样解释、旧记录能否读取。
- **写入:** 创建 Run,逐 attempt 写主记录与 artifact,完成时封口。
- **读取:** 扫描记录根,按 experiment / run / eval / attempt 导航,并按需加载大文件。
- **身份:** 为 attempt 生成稳定 locator,保证报告里的数字能回到证据。
- **发布:** 解引用一组 Run 的 artifact 并复制成自包含目录,跨出可信边界。

它不负责选择口径、覆盖判断、指标、聚合、图表或终端排版,也不负责执行 eval。

## 常见用途

| 用途 | API / 命令 |
|---|---|
| 调试最近一次运行 | `niceeval show` / `niceeval view` |
| 在脚本中遍历全部历史 | `openRecord()` + `record.experiments` |
| 读取对话、源码或 diff | `AttemptHandle.events()` / `sources()` / `diff()` |
| 发布精简记录集 | `publish()` |
| 导入第三方运行结果 | `createWriter()` |
| 选一个口径来看 | [`niceeval/sample`](../sample/README.md) |

## 相关阅读

- [Library](library.md) —— `niceeval/record` 的 TS 读写 API。
- [Architecture](architecture.md) —— 磁盘上的格式规范。
- [Sample](../sample/README.md) —— 从记录选出一份可比较的样本。
- [Reports](../reports/README.md) —— 建立在样本之上的终端、网页和自定义报告。
- [Experiments](../experiments/README.md) —— experimentId、运行期选题计划与物理 Attempt 从哪来。
