# 裁决:`config.report` 收 ReportDefinition 值,`--report` 裸词是内建视图名

**日期**:2026-07-25(用户裁决)

## 裁决

1. `defineConfig` 新增 `report?: ReportDefinition`,收 `defineReport` 产物**本身**(配置里 `import site from "./reports/site"`),不是路径字符串。
2. `--report` 同时收内建视图名与报告文件:**裸词 = 名字**(查 `niceeval/report/built-in` 的具名导出表,当前只有 `standard`),**带路径形 = 文件**(含 `/`、以 `.` 开头,或 `.ts`/`.tsx`/`.js`/`.mjs` 后缀)。判别只看字符串,不探测文件系统;裸词未命中报错列出可用名字并提示路径写法。
3. 装载取值链恰好三档:`--report` → `config.report` → 内建 `standard`。

契约落点:`docs/feature/reports/architecture.md#外壳与页装载规范化`、`docs/feature/reports/README.md#项目默认报告`;实现 TODO 在 `plan/default-report-config.md`。

## 曾选方案与否决理由

- **`report` 收文件路径字符串**(与 `--report <file>` 同形):否决。配置是 TS 文件,收值才有类型检查(路径写错要到 `show`/`view` 才炸),且与 `sandbox`(只收工厂产出的 spec)、`reporters`(收值)的既有纪律一致。代价是 `niceeval exp` 也会 import 报告树,接受——报告树只是声明,不进运行路径。
- **加 `--no-report` 布尔 flag** 作「回到内建」的出口:否决。为一个字段长一个 CLI 开关,且与 `--report` 互斥规则又多一条。
- **`--report` 泛化成收任意 ESM 模块说明符**(`--report niceeval/report/built-in`):否决。内建视图本来就有名字(具名导出),让 CLI 直接认这个名字比让用户写包路径短,也不用改「`--report` 收什么」的心智。
- **内建名加前缀区分**(`built-in:standard`):否决。名表就一张,裸词形态已经无歧义,前缀是白记的语法。

## 连带确认

~~`view` 本地 server 的 mtime cache-busting 只击穿装载入口本体……边写边看要用 `--report`。~~
已由 [view-hot-reload-needs-namespace-import](view-hot-reload-needs-namespace-import.md) 翻案：
本地模式对 config / `--report` 都失效整棵项目内 import 图，不必为边写边看改 flag。
