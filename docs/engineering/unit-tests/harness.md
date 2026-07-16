# 测试 Harness —— 共享构造器的所有权与稳定性

测试代码里的 `scriptedAgent`、`recordingSandbox`、`runnerFixture`、`attemptEvidenceFixture`、`resultsDirFixture`、`reportScopeFixture` 这类构造器统称 harness。它们是几十条测试的共同依赖：harness 的接口一动，所有用它的测试跟着动。因此 harness 是[变更预算](../testing/README.md)最大的杠杆，本篇定义它的所有权、稳定性和设计规则。

## 所有权

- **每个 harness 归属一个 Feature 测试目录**，与使用它的测试同住，由该 Feature 的测试维护者演进。目录见 [unit-tests/README.md](README.md) 的 Feature 清单。
- **跨 Feature 只共享机械构造能力**：造临时目录、拼一个合法 `StreamEvent`、生成稳定脱敏 id 这类无场景语义的工具可以共享；场景输入和期望值永远留在使用它的测试旁边，让读者在一个文件里看到一条契约如何被证明。
- 一个 harness 被第二个 Feature 想借用时，先判断借用的是机械能力还是场景语义——是后者就复制并各自演进，不共享。共享场景 harness 会把两个 Feature 的变更预算焊在一起。

## 稳定性契约

harness 的公开形状（构造参数、返回句柄上的观察方法）**只随 Feature 契约变化，不随实现重构变化**：

- 生产代码重构、换内部数据结构、改私有调用链时，维持 harness 接口不变是 harness 实现的义务——它可以改自己的内部实现来适配。
- 实现重构逼得 harness 必须改接口，说明 harness 绑定了实现细节（暴露了内部状态、锁定了私有调用序列），这是 harness 的设计缺陷：修 harness，并把绑定原因记入 `memory/`。
- Feature 契约变化时，harness 接口随契约一起重写，使用它的测试属于该契约的影响面，同批更新——这是合法变更。

## 设计规则

各 Feature 的测试架构页（`<feature>/README.md`）定义自己 harness 的具体形状，共同遵守：

- **输入受测试控制，决策归生产代码。** harness 只控制输入内容和完成时机（barrier、脚本化 Turn、受控时钟），不复刻生产算法，不预判生产代码应产出什么。fixture 里复制一份实现再对答案，只能发现两边没同步改。
- **未预期的调用抛错，不静默兜底。** 没有排到脚本的方法调用抛 `unexpected call`，不返回空字符串、空数组或成功结果；生产代码意外多一次调用时测试要失败，而不是拿假数据继续通过。
- **"明确空"与"未知"是两种构造。** 空数组表示"确认没有"，unknown/incomplete 状态必须显式构造；harness 不允许一个默认值同时冒充两种语义。
- **身份字段必填，不用全局自增器偷偷生成。** 参与身份、去重或选择的字段（`startedAt`、`attempt`、`experimentId`……）由测试写明，读者必须能从 case 看出两条记录应该相同还是不同。
- **场景要有区分力。** fixture 构造的输入必须让契约算法与常见错误算法给出不同答案；所有候选算法都会通过的输入没有证明力。各 Feature 的 `cases.md` 里的区分力设计（聚合口径、现刻水位、scope 三收者）是范例。
- **观察面是公开语义,不是调用轨迹。** 句柄上暴露"启动了哪些 attempt""收到了什么输入""哪些资源已释放"这类可观察事实,不暴露"内部调了几次某函数"。

## Harness 自身不单独测试

harness 的错误由使用它的测试暴露：脚本错了断言就错，抛错缺了假通过会在评审对照 `cases.md` 时现形。一个 harness 复杂到需要自己的测试套件，说明它承载了本该属于生产代码或测试本身的语义——拆薄它，而不是给它写测试。
