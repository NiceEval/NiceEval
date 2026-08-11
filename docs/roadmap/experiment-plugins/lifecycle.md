# Experiment Plugins —— Lifecycle

## 唯一时间轴

插件只向现有调用点插入 contribution。Sandbox 型 Agent 的前向顺序为:

```text
Experiment author setup
  → Experiment plugins[].experiment.setup
  → create physical Sandbox
  → template owner author layer physical setup
  → other author layer physical setup
  → Experiment plugins[].sandbox physical setup
  → template owner author prepare
  → other author prepare
  → Experiment plugins[].sandbox prepare
  → agent.ensure
  → Agent receiver 组合后的 setup / postSetup 槽位
  → Eval body / Agent send
```

Experiment author setup 是最外层作者资源,插件按 `plugins` 数组顺序进入。Sandbox 的 template owner / other owner 既有先后保持不变,插件 contribution 固定排在两个作者 layer 之后、`agent.ensure` 之前。

Agent receiver 把 extension 分别编入 Adapter 原有的配置、安装、`postSetup` 与 `preTeardown` 槽位;不存在统一的“plugin agent setup”阶段。

## 三个资源作用域

LIFO 只在拥有确定 setup 次序的单个资源作用域内成立:

| Scope | 状态粒度 | setup 次数 | teardown 次数 |
|---|---|---:|---:|
| Experiment | 一个 Linked Plugin Instance / Run | 整场至多一次 | setup 时点到达后至多一次 |
| physical Sandbox | 一个实际 Sandbox 实例 | 实例创建后一次 | 实例退休前一次 |
| Attempt / Agent | 一个 Attempt | 每条一次 | setup 时点到达后每条一次 |

每个成对节点在进入 setup 时点前登记 finalizer。setup 中途抛错不豁免自身 teardown;未到达该时点的节点不产生虚假收尾。

同一 scope 内,setup 按作者与 plugins 的前向顺序执行,teardown 按实际登记逆序执行。跨 scope 的大顺序仍由 Runner 现有嵌套决定:Agent 收尾先于 Sandbox 作者 cleanup / physical teardown,Experiment teardown 等全部 Attempt 与 Sandbox 收口后执行。

并发 Attempt 各有自己的 scope,不存在稳定的跨 Attempt setup 总序,因此也不存在跨 Attempt 的“全局 LIFO”。

## 失败与中断

- selection / link / planning requirement 失败:创建资源前聚合报配置错误,列出 contribution source 与 pair。
- Experiment plugin setup 失败:沿用 `experiment.setup` 的失败与同实验隔离语义;已经到达时点的 plugin teardown 仍逆序执行。
- Sandbox plugin prepare / setup 失败:沿用 `sandbox.prepare.experiment` 或对应 physical lifecycle phase;Attempt errored,已登记 finalizer 继续执行。
- AgentExtension 冲突:在 pure link 失败,不进入 Agent setup。
- Agent `postSetup` 失败:沿用 `agent.setup`;`preTeardown` 的成对触发规则由 receiver 所属 Adapter 保持。
- teardown 失败:沿用所在 scope 的 diagnostic 与 timeout 契约,不改已经定稿的 verdict。
- 用户中断与强清:继续使用现有 Scope / teardown registry,插件不能另开 detached cleanup runtime。

## Dry plan

`niceeval exp ... --dry --commands` 展示规范化后的 plugin identity、requirements、SandboxCommand 与 Agent receiver manifest 摘要。静态 shell / command 仍可按真实槽位排序展示;数据依赖 callback 保持 opaque。

Dry plan 不求值 effective auth/provider binding、不显示 secret value,也不执行 Remem 版本探测。它能在零资源阶段发现 receiver 不支持、slot 冲突、Sequence / stop-group 缺失和 requested lifetime 不足;镜像中 Remem 是否真实存在要到 `sandbox.prepare.experiment` 才能确定。
