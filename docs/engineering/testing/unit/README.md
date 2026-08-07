# Unit：确定性语义测试

Unit 只负责真实场景 Repo 无法稳定制造、无法穷举或无法精确定位的确定性风险。
它不按源码目录、函数、类型或分支机械增加测试。

## 存在资格

新增 Unit 前必须回答：

1. 它证明哪条产品契约或仓库约束？
2. 删除它会让哪一种具名错误算法通过？
3. 为什么对应 E2E 无法稳定制造或区分该错误？
4. 这张等价类矩阵是否已经有 owner？

答不清时不写。E2E 已完整证明同一命题时，Unit 只能保留能排除另一种错误实现的最小代表，不能复制整张矩阵。

## 适合 Unit 的风险

- 纯选择、归一、聚合、schema 与错误分类；
- fingerprint、cache 与 carry 的等价类矩阵；
- barrier、fake clock 与受控 Promise 下的 retry、lock 和调度；
- NiceEval 自有接口之上的状态机与生命周期；
- 类型推断、非法组合、exports 与仓库机器守护。

安装、外部 cwd、真实进程 pipe、HTTP、浏览器、signal 与 provider 协议归 [E2E](../e2e/README.md)。

## Fake 边界：mock 什么，测哪一层

Unit 只使用两类替代：构造输入数据，或 fake NiceEval 自己声明的稳定接口。

- 文件系统使用每例独立的真实临时目录，不 mock fs；
- Agent、Sandbox、Reporter、Judge 传输和时钟可以在自有接口处 fake；
- 上游 SDK / CLI 的原始事件形状不得复制成 wire fixture；
- 真实协议兼容性只由对应 Adapter Repo 证明；
- 纯转换只有在输入词表属于 NiceEval 自有稳定契约时才归 Unit。

Unit 的观察面是确定性数据与状态，不是安装后的进程、终端排版、HTML、DOM、样式或浏览器交互。

## Fixture 与 Harness

Fixture 只显式填写本 case 有语义的字段；builder 补机械默认值，但不计算 verdict、delta、summary 或 expected。

- 输入受测试控制，决策归生产代码；
- 未预期调用立即抛错，不静默返回空值；
- “明确空”与“未知”使用不同构造；
- 身份、去重与选择字段由 case 写明，不用全局自增器暗中生成；
- 生产 DTO 增加无关字段时，只允许修改 builder，不应批量修改 case；
- Harness 归一个 Feature；跨 Feature 只共享临时目录、字节生成等机械构造能力；
- Harness 复杂到需要独立测试时，应拆薄，而不是再建一套测试。

## 矩阵与覆盖登记

每个 Feature 测试文档的“覆盖规范”只登记稳定风险类别、唯一矩阵 owner 与 Fixture 特例，不复述产品契约或逐 case 清单。

- 新类别先写入对应 Feature 测试文档，再写测试；
- `test.each` 只展开动作与断言完全相同的一个等价类；
- 同一场景的第二条测试是维护负担；
- Bug 先加强原 owner，确实杀死旧实现时才写 `// bug: memory/<条目>.md`；
- 新 owner 接管时，同批删除旧 owner。

源码测试文件第一行用 `// cases: docs/engineering/testing/unit/<feature>.md` 声明归属。
机器守护只检查文档与测试没有整册脱钩；类别是否唯一仍由评审判断。

## Feature 测试文档

| 产品域 | Unit owner 文档 |
|---|---|
| Eval | [eval.md](eval.md) |
| Experiments 与 Runner | [experiments-runner.md](experiments-runner.md) |
| Sandbox | [sandbox.md](sandbox.md) |
| Adapter 的自有确定性逻辑 | [adapters.md](adapters.md) |
| Assertions | [assertions.md](assertions.md) |
| Record | [record.md](record.md) |
| Sample | [sample.md](sample.md) |
| Reports | [reports.md](reports.md) |

这些页面不是测试数量清单。具体场景以测试文件与标题为准。

## 类型契约

类型测试由 `pnpm run typecheck` 执行。公共子路径、合法推断与禁止组合可以使用编译 Fixture 和 `@ts-expect-error` 表达。
类型检查不证明运行时序列化、parser、错误反馈或额外字段行为。

## 无意义或脆弱的 Unit

以下测试应删除或改写：

- 每个导出函数、类型或实现分支各写一条；
- mock 返回什么就断言什么；
- Fixture 复刻生产算法后与生产结果对答案；
- 锁定私有调用次数、顺序、函数名或源码文本；
- 用 Unit 断言终端排版、HTML、DOM、样式或 CLI 进程；
- 从候选实现导入常量生成 expected；
- 无法说明会放走哪种错误的 snapshot 或覆盖率补测。

## 运行与守护

- `pnpm test`：无网络、无容器、无凭据；全量 60 秒内、单文件 5 秒内；
- `pnpm test <路径或名称>`：按 Feature 切片；
- `pnpm run typecheck`：类型契约；
- `pnpm test:docs`：`// cases:`、`// bug:`、索引与链接守护。

`src/**/*.test.ts(x)` 与 `test/unit/**` 归代码侧 Unit project；`test/docs/**` 与 `test/docs-site/**` 各归自己的文档入口。
