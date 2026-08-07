# 测试 Harness：共享构造器的边界

`scriptedAgent`、`recordingSandbox`、`runnerFixture` 与 `reportScopeFixture` 这类测试构造器统称 harness。
它们是多条测试的共同依赖，因此是[变更预算](../README.md)最大的杠杆。本页只规定所有权与稳定性，不建立第二套 Unit 总纲。

## 所有权

- 每个 harness 只归属一个 Feature，与使用它的测试同住；Feature 清单见 [Unit 入口](README.md)。
- 跨 Feature 只共享临时目录、字节生成、稳定脱敏 id 等机械能力；场景输入和 expected 留在使用它的测试旁。
- 第二个 Feature 想复用时，先判断复用的是机械能力还是场景语义；后者应复制并独立演进，避免焊接两个变更预算。

## 稳定性

harness 的构造参数与观察句柄只随 Feature 契约变化，不随生产实现重构变化。

- 私有数据结构或调用链变化时，harness 自己适配，使用它的 case 不应批量改写。
- 实现重构迫使 harness 改接口，说明它暴露了内部状态或调用轨迹；应先修薄 harness。
- Feature 契约变化时，harness 与受影响测试同批重写。

## 设计规则

- 输入受测试控制，决策归生产代码；fixture 不复制生产算法生成 expected。
- 未排入脚本的调用抛 `unexpected call`，不返回空值或成功结果继续假通过。
- “明确空”与“未知”使用不同构造。
- 身份、去重与选择字段由 case 明写，不用全局自增器暗中生成。
- 场景必须区分契约算法与一种常见错误算法。
- 观察面是启动、输入、结果与资源释放等公开事实，不是私有函数调用次数或顺序。

Harness 不另建自己的测试套件。复杂到需要单独测试时，应把语义移回生产代码或具体 case，并拆薄构造器。
