# Unit：确定性语义例外

Unit 不是功能实现的默认测试形态。它只负责 Journey 与单边界 E2E 无法稳定制造、无法穷举或无法精确区分的确定性风险。
它不按源码目录、函数、类型或分支机械增加测试。

## 存在资格

新增或保留 Unit 前必须先回答：为什么真实 E2E 不能直接、稳定地制造输入并观察同一错误结果？
回答“与其它 Unit 不重复”无效。通过这道门后，才继续回答：

1. 它证明哪条产品契约或仓库约束？
2. 删除它会让哪一种具名错误算法通过？
3. 对应用户结果由哪个 Journey 或单边界 E2E 拥有？
4. 为什么该 E2E 无法稳定制造、穷举或区分这类错误？
5. 最小等价类矩阵是什么，是否已有 owner？
6. 测试通过哪个公共 API、NiceEval 自有稳定 port 或集中测试 seam 进入？

答不清时不写或退役。E2E 能直接证明同一命题时，Unit 全部删除；不能以另一种错误实现、定位速度或矩阵较小为由保留第二层 owner。
直接 import 私有函数、锁调用顺序或散布私有模块路径，不满足稳定 seam 条件。

这套资格对存量测试同样生效。当前文件存在、历史上曾经发现 bug、或 Feature 测试文档列过类别，都不提供保留资格。
复核必须从产品契约和 E2E 观察面重新推导，不能从现有测试列表倒推需要保护的行为。

## 可能成为 Unit 例外的风险

- 纯选择、归一、聚合、schema 与错误分类；
- fingerprint、cache 与 carry 的等价类矩阵；
- barrier、fake clock 与受控 Promise 下的 retry、lock 和调度；
- NiceEval 自有接口之上的状态机与生命周期；
- 类型推断、非法组合、exports 与仓库机器守护。

这张清单只表示可能性，不构成整类豁免。每个风险仍要逐项通过存在资格。

安装、外部 cwd、真实进程 pipe、HTTP、浏览器、signal、资源终态与 provider 协议归 [E2E](../e2e/README.md)。
公共 Library 与 Record 格式从安装后 package export 进入单边界 E2E；Unit 只保留无法由该边界穷举的非法输入或算法矩阵。

## Fake 边界：mock 什么，测哪一层

Unit 只使用两类替代：构造输入数据，或 fake NiceEval 自己声明的稳定接口。

- 文件系统使用每例独立的真实临时目录，不 mock fs；
- Agent、Sandbox、Reporter、Judge 传输和时钟可以在自有接口处 fake；
- 上游 SDK / CLI 的原始事件形状不得复制成 wire fixture；
- 真实协议兼容性只由对应 Adapter Repo 证明；
- 纯转换只有在输入词表属于 NiceEval 自有稳定契约、且 E2E 无法稳定区分具名错误算法时，才可能登记为 Unit 例外。

Unit 的观察面是确定性数据与状态，不是安装后的进程、终端排版、HTML、DOM、样式或浏览器交互。
浏览器或真实 PTY 无法稳定穷举的纯布局算法可以例外保留，但必须通过稳定 seam，且不能接管 renderer 选择或可见结果。

## Fixture 与 Harness

共享构造器的所有权与稳定性细则见 [Harness](harness.md)。

Fixture 只显式填写本 case 有语义的字段；builder 补机械默认值，但不计算 verdict、delta、summary 或 expected。

- 输入受测试控制，决策归生产代码；
- 未预期调用立即抛错，不静默返回空值；
- “明确空”与“未知”使用不同构造；
- 身份、去重与选择字段由 case 写明，不用全局自增器暗中生成；
- 生产 DTO 增加无关字段时，只允许修改 builder，不应批量修改 case；
- Harness 归一个 Feature；跨 Feature 只共享临时目录、字节生成等机械构造能力；
- Harness 复杂到需要独立测试时，应拆薄，而不是再建一套测试。

## 矩阵与覆盖登记

“先声明、后写测”的准入流程与类别预算见 [风险类别登记](registry.md)。

每个 Feature 测试文档的“例外规范”只登记稳定风险类别、唯一矩阵 owner 与 Fixture 特例，不复述产品契约或逐 case 清单。

- 新类别先写入对应 Feature 测试文档，并完成 E2E 不足与稳定 seam 说明，再写测试；
- `test.each` 只展开动作与断言完全相同的一个等价类；
- 同一场景的第二条测试是维护负担；
- Bug 先加强原 owner，确实杀死旧实现时才写 `// bug: memory/<条目>.md`；
- 新 owner 接管时，同批删除旧 owner。

测试文件第一行用 `// owner: docs/engineering/testing/unit/<feature>.md#<anchor>` 声明唯一归属。
一份文件只拥有一个具名风险；`test.each` 可以展开该风险的一张矩阵。
机器守护检查 owner 唯一与链接存在；必要性、矩阵是否最小及稳定 seam 仍由评审判断。

## Feature 测试文档

| 产品域 | Unit owner 文档 |
| --- | --- |
| Experiments 与 Runner | [experiments-runner.md](experiments-runner.md) |
| Sandbox | [sandbox.md](sandbox.md) |
| Record | [record.md](record.md) |

这些页面是 Unit 例外登记，不是测试数量清单。页面中没有 E2E 不足与稳定 seam 说明的类别，不能据此保留 Unit。

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
- 无法通过重复运行接管门，却靠 retry、固定 sleep 或放宽断言转绿。

## 运行与守护

- `pnpm test`：无网络、无容器、无凭据；全量 60 秒内、单文件 5 秒内；
- `pnpm test` 报告的 Tests 总数不得超过 200；Testkit 不设独立 Unit 套件；
- `pnpm test <路径或名称>`：按 Feature 切片；
- `pnpm run typecheck`：类型契约；
- `pnpm lint`：文档与文档站规则，包括 `// owner:`、索引与链接检查。

`src/**/*.test.ts(x)` 与 `test/unit/**` 归代码侧 Unit project；`lint/docs/**/*.lint.ts` 与 `lint/docs-site/**/*.lint.ts` 归统一文档 lint 入口。
