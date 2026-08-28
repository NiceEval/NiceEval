# E2E 测试正文

E2E 使用 Vitest 或 Playwright Test 原生文件、标题、hook、断言和报告能力。
NiceEval 只提供候选包注入、场景 Repo 隔离与 Testkit 机械原语，不建立第二套断言 DSL。

## 文件形状

关系 subject 是 runner collection 后的 case。每个 live case 的 title 末尾携带唯一 `necase_...` token；owner、regression
与 Issue 位于相邻受管 sidecar。一个文件可以含多个独立 cases，但每个 case 必须各自拥有稳定身份与恰好一个 owner。

```ts
test("query run 经 pipe 交付完整文档 [necase_7J4M2N6Q8R3T5V9X]", async () => {
  // 完整 argv、公开观察与独立 expected 留在这里。
});
```

受管 `show` 同时给出从 NiceEval 根目录按 Repo、文件和 caseId/title 重跑的命令。
读者只打开测试文件，就能找到用户动作、预期结果与最早失败接缝。

## 执行 NiceEval 命令

命令使用 argv 数组，不经 shell 字符串拼接。调用点保留完整产品参数，Testkit 只隐藏 spawn、字节收集与 timeout：

```ts
const result = await runProcess([
  "pnpm", "--silent", "exec", "niceeval", "query", "run", "--request", requestPath,
]);

expect(result.exitCode, result.diagnostic()).toBe(0);
const decoded = decodeInspectionDocument(result.json<unknown>());
expect(decoded.success, decoded.success ? "" : decoded.reason).toBe(true);
if (!decoded.success) throw new Error(decoded.reason);

const attempt = narrowInspectionSuccess(decoded.value, "attempt.get");
expect(attempt.success, attempt.success ? "" : attempt.reason).toBe(true);
```

非零 exit、signal 与 timeout 都返回完整 ProcessReceipt。只有进程无法启动时抛 `ProcessStartError`。
诊断展示可以裁剪，parser 与断言必须读取完整 stdout / stderr。Testkit 只负责完整解码后再按 `outcome` 与
operation 做语义窄化；它不以泛型断言跳过 Schema，也不维护 alias、fallback 或 Node 专用协议。

## 阶段与断言

测试正文按 prepare、invoke、observe、outcome、cleanup 阅读，但不为这五步建立 DSL。

- prepare 只准备 Repo 副本、依赖、fixture 与 owned resource；
- invoke 经过安装后 binary、公开 package API、HTTP 或浏览器动作；
- observe 严格解码输出并按稳定身份查找；
- outcome 比较独立 expected，不从候选实现反推答案；
- cleanup 无条件终结资源，并保留更早失败。

Journey 在每个域间接缝立即断言，不把整段流程压成最后一个页面断言。
同一 owner 的最小等价类可由原生 runner 的 `test.each` 展开；独立结果不能只靠拆成同文件的多个 `test()` 冒充独立 owner。
共享 Evidence 只有冻结后才能只读复用。

检查点只服务 Journey 的终态。一个命题拥有独立输入、独立 expected、独立修复动作，或能与终态独立失败时，
它不属于该 Journey，必须拥有另一测试文件和 owner。

## 稳定与可靠

稳定的定义是小更改只修改真实契约影响范围内的测试；逐类预算与 blocking 裁决见
[测试总纲](../README.md#稳定性变更预算)。测试读取公开结果的稳定身份与关系，
不锁动态 ID、临时端口、duration、DOM class 或私有文件布局。

可靠要求同一 candidate、输入与运行条件反复执行时不意外失败。测试使用确定性 fixture、显式 seed / 时钟策略、条件等待和私有状态。
固定 sleep、共享可变结果、兄弟文件顺序、测试级 retry 与未终结资源都违反可靠性。

新增、接管或实质修改确定性 owner 时，按[可靠性接管门](../README.md#可靠性重复运行)执行三个彼此隔离的副本、同副本连续运行、默认并行和单项重跑。
真实 provider live owner 只做一次已授权真实运行；完整 takeover 需要另行取得调用次数 / 成本授权。
自动化无法通过该门时，不降低断言或复制生产算法；按[不自动化](../README.md#不自动化)改做本次 AI 真实验收。

## 失败分类

| 分类 | 判据 | 重试 |
|---|---|---|
| Regression | 候选、断言、timeout 或 cleanup 违反 Repo 契约 | 不重试 |
| Infrastructure | 可结构化确认的 provider 429 / 5xx、网络、runner 或 Docker daemon 故障 | 新副本最多一次 |
| Configuration | 显式选择后缺 runtime、secret、镜像或 daemon | 不重试，prepare 前失败 |
| Not selected | lane 或 path 没有选择该 Repo | 计划中可见，不伪装成 pass |

判不清时按 Regression。cleanup 失败不能遮蔽正文失败，也不能靠重试漂绿。

## 浏览器

浏览器测试使用 Playwright Test 的 `page` fixture、web-first assertion、trace 与 screenshot。
测试沿真实 `href` 验证 URL、HTTP 与目标实体，不拼内部导出路径，不断言未公开 class 或 DOM 层级。
缺少稳定 role、label 或可见身份时，应先补产品契约，不能在测试里臆造身份。
