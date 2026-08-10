# Assertions —— 架构

Assertion 是一次 Attempt 内的检查结果。值 matcher、作用域检查、Sandbox 检查、资源限制和 Judge 都先形成 producer 内存结果，再由 producer 写入 Attempt-owned <code>niceeval.assertions</code> channel。

Assertion 不拥有 Run membership、Attempt origin 或报告聚合。Record 也不保存作者调用了哪个 API、matcher 怎样实现、控制流在哪里停止或求值图怎样组织。

~~~text
author API / matcher / collector / evaluation
                      ↓
        producer 内存求值与 Verdict 折叠
               ↙                 ↘
niceeval.assertions 稳定投影   niceeval.verdict
               ↓
      标准 Attempt detail Report
~~~

## 稳定落盘投影

<code>niceeval.assertions</code> 是 Attempt-owned、<code>application/json</code> 的永久展示通道。它从全新 <code>niceeval.record</code> 的第一次发布起冻结为以下精确 document：

```ts
type AssertionsDocument = {
  entries: readonly AssertionEntry[];
};

type AssertionEntry = CheckEntry | DirectScoreEntry;

type EntryContext = {
  name: string;
  groupPath: readonly string[];
  detail?: string;
  source?: {
    path: string;
    line: number;
    column: number;
  };
};

type CheckEntry = EntryContext & {
  kind: "check";
  decision:
    | { kind: "gate"; threshold: number }
    | { kind: "soft"; threshold: number }
    | { kind: "observe" };
  availability: "required" | "optional";
  result:
    | {
        state: "available";
        score: number;
        expected?: string;
        received?: string;
        evidence?: string;
      }
    | {
        state: "unavailable";
        reason: string;
        evidence?: string;
      };
  award:
    | { kind: "none" }
    | { kind: "conditional"; available: number };
};

type DirectScoreEntry = {
  kind: "score";
  name: string;
  groupPath: readonly string[];
  source?: {
    path: string;
    line: number;
    column: number;
  };
  points: number;
};
```

对象是精确对象，任何未知字段、缺失字段、错误联合或重复 object key 都使整个同名通道 invalid。条目按声明顺序保存；同名条目合法，由数组位置区分。对象 key 顺序在成功 JSON parse 后无义。

<code>name</code> 与 <code>groupPath</code> 组织页面，<code>detail</code> 是稳定的人读检查摘要，不是 public API 或 matcher identity。作者语义按下表归一：

| producer 求值语义 | 稳定投影 |
|---|---|
| gate 与最终通过线 | <code>decision.kind: "gate"</code> 与显式 threshold |
| 带通过线的 soft | <code>decision.kind: "soft"</code> 与显式 threshold |
| 不设通过线的纯观测 | <code>decision.kind: "observe"</code> |
| required / optional | 对应的 <code>availability</code> |
| 条件给分 / 直接给分 | conditional award / direct score entry |
| <code>stopOnFailure</code> 与其它控制流 | 不写入本通道 |

producer 必须把 matcher 默认通过线也写成显式 <code>threshold</code>。<code>gate</code> 和 <code>soft</code> 的行级 passed/failed 唯一按 ECMAScript Number 的 <code>score &gt;= threshold</code> 派生。

<code>observe</code> 不派生 passed/failed。

<code>decision</code> 保存该行的业务分类。strict policy 是否生效不重写它。<code>award.kind: "conditional"</code> 的实得分唯一按 ECMAScript Number 的 <code>available * score</code> 派生，不落冗余字段；unavailable 条目不派生实得分。

<code>t.score(label, points)</code> 归一成 <code>DirectScoreEntry</code>，直接保存 points。Report 不从任何 Assertion 重新折叠 Attempt Verdict；它只读取独立的 <code>niceeval.verdict</code>。

## 精确边界

所有限制都是 <code>niceeval.assertions</code> 的永久契约，不能在同名 decoder 中放宽。

| 范围 | 约束 |
|---|---|
| document | 最多 4,096 个 entries。 |
| 通用字符串 | 必须是合法 Unicode scalar sequence；lone surrogate 非法。 |
| <code>name</code>、<code>groupPath</code> segment、<code>detail</code>、<code>reason</code> | 非空 NFC，拒绝 C0 与 DEL；每项按解码后字符串计算，最多 512 UTF-8 bytes。 |
| <code>groupPath</code> | 最多 16 个 segment；空数组表示根组。 |
| <code>expected</code>、<code>received</code>、<code>evidence</code> | 每项最多 4,096 UTF-8 bytes；缺失表示未提供，空串表示提供了空预览；内容原样保留，由 renderer 去除控制字符。 |
| <code>source.path</code> | 非空项目相对 POSIX 路径，最多 1,024 UTF-8 bytes；拒绝绝对路径、反斜杠、C0、DEL，以及空、<code>.</code> 或 <code>..</code> segment。 |
| <code>source.line</code>、<code>source.column</code> | 正安全整数。 |
| <code>score</code>、<code>threshold</code> | 有限数且位于 <code>[0, 1]</code>；拒绝 <code>-0</code>。 |
| conditional <code>available</code> | 有限正数；拒绝 <code>-0</code>。 |
| direct <code>points</code> | 有限非负数；允许 <code>0</code>，拒绝 <code>-0</code>。 |

按 entries 声明顺序，以 ECMAScript Number 累加所有 direct points 与 conditional available，结果也必须有限。这条上限保证单个 Attempt 的标准 Assertions 分数聚合闭合；它不限制整个 ReportInput 的总内存。

文件读取分为三层：

1. <code>FileValid(file)</code>：目标是普通、非 symbolic link 文件，并以 no-follow 方式读取。
2. <code>TransportValid(rawBytes)</code>：实际 raw bytes 不超过 4,194,304 bytes，是合法 UTF-8，拒绝重复 object key，且 JSON parse 成功。
3. <code>ContractValid(value)</code>：decoded value 满足精确联合与本节全部值限制。

writer 对 ECMAScript <code>JSON.stringify(document)</code> 的紧凑 UTF-8 结果执行同一个 4 MiB 限制。越界时在发布 Attempt 前以 <code>record-input-invalid</code> 拒绝；人工编辑造成的越界或非法值成为同名 <code>ChannelRead.invalid</code>。

JSON 空白可能让 raw file 超限，因此只在 <code>TransportValid</code> 成立并成功 JSON parse 后才忽略空白与 object key 顺序。数组顺序始终有义。

## 跨上层 API 的兼容性

作者 API、matcher 名称、collector、memoization、Fact 使用图、evaluation algorithm 和 <code>stopOnFailure</code> 都不进入这份 document。上层可以替换这些实现，只要 producer 继续写出同一冻结投影，Record reader 与标准 Report 就无需改变。

<code>ReadPreserved(oldChannelFile, newReader)</code> 适用于任何历史上同时满足 FileValid、TransportValid 与 ContractValid 的同名 channel file，包括合法人工编辑。

新 reader 必须把它解码成 JSON 深等价的值。数组顺序有义，对象 key 顺序与 JSON 空白无义。

<code>DisplayEquivalent(leftDecoded, rightDecoded, definition, runtime)</code> 只约束确定性的标准 Assertions projection。固定 fixture 使两份 decoded value 逐字段相等时，同一标准 requirement、Report definition 与 runtime 必须形成相等的 <code>PageModel</code> 和 <code>textAlternative</code>。

show 与 view 消费同一份 <code>ReportExecution</code>。从旧 Record 重新 export 只承诺当前 exporter 能成功消费，不承诺导出目录逐 byte 相等，也不约束读取时间或随机源的用户自定义 Report。

这项承诺从第一版 <code>niceeval.record</code> writer 开始，不包含 <code>niceeval.results</code>。实现时必须保存第一版 writer 产生的原始 fixture bytes；未来 reader 不能用未来 writer 重新生成 fixture 来替代跨代证明。

未来若需要新字段、新语义或更大限制，新增没有数字版本后缀的描述性 business channel，并永久保留旧 assertions decoder 与标准 Attempt detail 消费入口。

## 数据归属

Assertion collector 只消费调用方提供的值和已经交付的通道数据。它不打开 Record 路径，不读 ReportInput，也不生成报告页面。

source 位置信息可选。存在时，它只含项目相对路径和行列；第三方包不写入项目源码内容。

通道文件由 Attempt owner 写入。人工编辑停稳 Record 后，下一次 reader 和请求该事实的 Report 会看到新的 Assertion 数据；Sample 仍不读取业务通道。

## 与 Verdict 和 Reports 的关系

producer 在内存中根据 assertion 求值结果、执行错误和 strict policy 形成 <code>niceeval.verdict</code>，再分别写入两个独立通道。Verdict 规则由 [Verdict](../verdict/architecture.md) 单点定义。

Sample 只保留 Attempt 核心和分母，不读取 assertion。标准 Attempt detail 的永久内建 requirement 让 composition adapter 把 Assertions <code>ChannelRead</code> 放进内部 ReportInput。

Report 不能自行读取文件或重新计算 Attempt 业务状态。

## 相关阅读

- [Assertion 证据与完整性](architecture/evidence.md)
- [Assertion 展示](library/display.md)
- [Assertion Library](library.md)
- [Verdict](../verdict/README.md)
- [Record 通道](../record/architecture.md#通道语义与兼容性)
