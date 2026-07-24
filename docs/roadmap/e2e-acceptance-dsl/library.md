# Library 逐词表说明

`@niceeval/verify`(工作名)的完整断言词表。设计定位与形态裁决见 [README](README.md);逐场景写法见 [Use Cases](use-cases/README.md)。

库从一个入口导出四组能力:命令执行与证据句柄、语义树快照 matcher、容差 golden matcher、点查询。全部是普通函数与 vitest matcher,不带 runner、不带全局状态。

```ts
import { cli, evidence, term, printTermTree } from "@niceeval/verify";
import "@niceeval/verify/matchers"; // 注册 toMatchTermSnapshot / toMatchScrubbedFileSnapshot / toMatchAriaSnapshot
```

## 命令执行与证据句柄

### `cli(command, options?)`

继承[验收脚本写法](../../engineering/testing/e2e/verification.md)的两条约定:命令以 **shell 原文**出现(可整句复制到终端复现),预期非零退出是一等场景。

```ts
const { stdout } = await cli("pnpm exec niceeval show weather --history");        // 默认断言退出 0
const fail = await cli("pnpm exec niceeval exp deliberate-fail --force --json", { expect: "nonzero" });
fail.stdout; fail.stderr; fail.combined; fail.exit;
```

- `expect: 0 | number | "nonzero"`,不符即抛断言错误,消息含命令原文、实际退出码与 stderr 尾部。
- `cwd`:执行目录,默认仓库根;消费方边界一类的场景用它切到证据清单里的临时项目目录。
- 每次调用把命令与输出追加到证据日志(供 `e2e.ts` 的基础设施故障分类扫描),路径来自证据清单。

### `evidence()`

读取 prepare 阶段产出的证据清单(路径来自环境变量 `NICEEVAL_E2E_EVIDENCE`),返回只读句柄:

```ts
const ev = evidence();
ev.resultsRoot;                 // 本次运行的结果根
ev.locator("tool-call");        // prepare 提取好的 attempt locator,缺失即抛错并列出可用键
ev.exportDir("branded");        // 命名导出站目录
ev.consumerDir("react-jsx");    // prepare 搭好的临时消费方项目目录(消费边界场景)
ev.logPath;                     // 证据日志(cli() 自动追加的那份)
```

清单的产出方是仓库自己的 `scripts/e2e.ts` prepare 步骤;库只定义清单的形状与读取面,不定义怎么跑实验。

## 第一层:语义树快照 `toMatchTermSnapshot`

### 结构解析器

`term(text)` 先 strip ANSI,再把纯文本解析成结构树。节点词表是**通用终端排版概念**,识别规则以 [Library · 排版原语](../../feature/reports/library/layout.md)声明的排版契约为规范——解析器是渲染契约的第二实现,不含 niceeval 组件名:

| 节点 | 识别规则 | name 取值 |
|---|---|---|
| `document` | 整份输出的根 | — |
| `section` | 框线包围的区块(`╭╮╰╯` / `┌┐└┘` 及框内嵌套) | 框上沿的标题文字 |
| `heading` | 空行之后、紧邻结构块(table / tree / section)之前的独立文本行 | 该行折叠文本 |
| `table` | 连续行共享 ≥2 处字符列位对齐,首行为表头 | 表头折叠文本 |
| `row` | table 内的数据行 | 整行折叠文本 |
| `tree` | 缩进或 guide 字符(`│ ├ └`)组织的连续行 | 根行折叠文本 |
| `node` | tree 内的一行(嵌套用缩进表达) | 去掉 guide 后的折叠文本 |
| `line` | 兜底:不属于以上任何结构的文本行 | 该行折叠文本 |

「折叠文本」= 空白折叠(连续空白折成单空格、去首尾)后的行文本;折行续行并回原行——`looseIncludes()` 手工做的事在解析层统一完成。显示宽度口径(CJK 记 2 列)只服务解析,不暴露为断言面。

### 期望语法

YAML 子集,逐条照抄 aria-snapshot 的形状:

```yaml
- section "Attempts":          # "引号" = 折叠后精确匹配
  - table:
    - row /tool-call .* passed/   # /…/ = 正则
    - row /te-fail .* failed/
- heading /Cost .*× Pass rate/
- tree:                        # 省略 name = 只匹配节点类别
  - node /TOOL .* get_weather/:
    - node /Brooklyn/
- line: 0 matches in 1 attempt    # `- kind: 文本` = 匹配折叠文本(aria 的 listitem: 形式)
```

### 匹配语义

与 aria-snapshot 完全一致:

- **默认有序子序列**:期望的子节点须按序出现在实际子节点中,多出的实际节点忽略。渲染器新增一行注解、插一个区块,不打红已有断言。
- **省略即不关心**:不写 name 只查类别;不写子节点不查子树。
- **显式升级**:`- /children: equal` 令直接子节点精确匹配(个数、顺序、逐个匹配),`deep-equal` 逐层精确。锁「不多不少」的计数与顺序契约用这两档,不用默认档。
- 文本一律折叠后再比;正则对折叠文本执行。

### 使用与撰写回路

```ts
await expect(stdout).toMatchTermSnapshot(`
  - section "Experiments":
    - table:
      - row /main .* \\d+%/
`);
```

- 期望内联在测试里、**手工撰写**——它是契约的表达,不是录制产物,没有 `-u` 自动重写。
- 撰写辅助:`printTermTree(stdout)` 打印实际解析树,作者从中挑选要锁定的节点收窄成期望;失败输出也附带实际树(见失败反馈)。

### HTML 面:`toMatchAriaSnapshot`

导出 HTML 的语义结构断言不发明词表,直接采 aria-snapshot 语义的现成实现(Vitest 4.1.4+ / ivya),对文档的**可访问性树**匹配,语法与匹配语义同上(role 词表是 aria 的):

```ts
const doc = await loadExportedHtml(ev.exportDir("branded"), "attempt/te-fail.html"); // happy-dom 或 browser mode,取决于 spike 结论
await expect(doc.body).toMatchAriaSnapshot(`
  - region "Assertions":
    - list:
      - listitem: /equals\\(3\\).*failed/
`);
```

计算样式、几何、点击交互的断言不属于本层——保留现有 Playwright 写法(`getComputedStyle` 结构事实、`getBoundingClientRect` 同行判定、`<details>` 点击展开)。

## 第二层:容差 golden `toMatchScrubbedFileSnapshot`

对「每个字符都是契约」的窄稳表面(`--json` 摘要、JUnit、错误与用法文案)做整段 golden。比对前先过 scrub 归一管线——归一必须在传入 matcher 前完成(vitest 的自定义 serializer 不作用于 file snapshot,见 References):

```ts
await expect(fail.combined).toMatchScrubbedFileSnapshot("golden/deliberate-fail.txt", {
  scrub: [{ pattern: /run-\d{8}T\d{6}/g, tag: "RUN_ID" }],   // 仓库自定义规则,追加在内置表之后
});
```

内置 scrub 规则表(正则 → 占位符):

| 易变值 | 占位符 |
|---|---|
| ANSI 转义序列 | 删除 |
| 耗时(`3.2s` / `450ms` / `1m 12s`) | `[DURATION]` |
| 成本(`$0.0123`) | `[COST]` |
| token 计数(`12.3k tokens`) | `[TOKENS]` |
| attempt locator(`@…`) | `[LOCATOR]` |
| 结果根及其下路径 | `[ROOT]/…` |
| ISO 时间戳 | `[TIMESTAMP]` |

- golden 文件签入仓库;更新走 `vitest -u`,diff 即 review 面。
- scrub 后仍逐字符全等——没有 trycmd 的 `[..]`/`...` 行内通配。需要行级容差的表面说明它不够窄稳,应改用第一层。

## 第三层:点查询 `term()`

结构解析树上的导航与提取,把各 verify 脚本手搓的 helper 升格为库词表。适配器仓库读回的[子串级边界](../../engineering/testing/e2e/README.md#43-cli-读回)只需要这一层:

```ts
const t = term(stdout);

t.section("Attempts");                    // 按 name 找 section;支持 /re/
t.section("Attempts").table().rows();     // 行数组,每行有 .text(折叠文本)与 .cell(表头名)
t.tree().find(/get_weather/);             // 树内查找节点
t.line(/Brooklyn/);                       // 全文找行;找不到即抛错
t.has(/timing unavailable/);              // boolean,供反向断言 expect(...).toBe(false)
```

niceeval 惯用形的提取器属于本层、以 [Show](../../feature/reports/show.md) 的文档声明为规范(不是通用排版概念,单列出来):

```ts
t.historyRows();   // show --history 的 attempt 行:{ timestamp, verdict, locator, text }
t.stats();         // ✓/✗/! 计数行:{ passed, failed, errored } —— 断言数值,不断言字形
```

查询失败的错误信息带结构上下文与下一步,沿用[错误反馈原则](../../error-feedback.md):找不到 section 时列出实际存在的 section 名,找不到行时给出最近似候选。

## 失败反馈

- **语义树失配**:输出第一个失配节点的路径与对位实际内容,并附实际树:

  ```text
  toMatchTermSnapshot 失配
  路径: section "Attempts" > table > row[2]
  期望: - row /te-error .* errored/
  实际(该位置起的兄弟节点): - row "te-fail ✗ failed [DURATION] [COST]"
  实际完整结构树(printTermTree):
    - section "Attempts"
      - table "eval verdict duration cost"
        - row "tool-call ✓ passed …"
        …
  ```

- **golden 失配**:scrub 后的行级 diff;golden 文件不存在时首跑落盘并提示 review。
- **点查询失败**:命中为空时列出候选(实际 section 名、最近似行),消息模板强制含「哪条契约断了、下一步看哪里」。

## 与 vitest 的装配

- matcher 经 `expect.extend` 注册,`@niceeval/verify/matchers` 副作用导入一次生效;TS 类型经 module augmentation 提供。
- 证据清单在 globalSetup 校验存在与形状,缺失时整个 vitest run 快速失败并指向 prepare 步骤。
- 断言测试文件按验收组组织(`verify/render-structure.test.ts`、`verify/readback.test.ts`…),`describe`/`test` 名即断言分组名,`vitest -t` 按名单条重跑。
- `e2e.ts` 对 vitest 的退出码按既有规则折叠:非零一律回归,除非证据日志扫描确证外部故障(退 `75`)。
