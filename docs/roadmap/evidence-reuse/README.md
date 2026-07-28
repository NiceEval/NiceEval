# Evidence 复用政策

Roadmap 候选设计，见 [Roadmap 约定](../README.md)。
本主题名为 Evidence 复用政策：指纹只是实现索引，真正需要裁决的是历史 Evidence 在什么条件下仍算数，
以及用户可以承担多大风险来覆盖系统判断。

本目录故意保留两套互相冲突的默认政策，不把开放分歧写成一个含糊的“智能默认”：

- **证明优先：**系统只能证明 Evidence 仍有效时才沿用；未知默认重跑。
- **复用优先：**只有系统观察到相关变化时才重跑；未知默认沿用。

两套政策共享相同的输入清单、差异解释和审计记录，只改变 `opaque` 与未观测世界的默认方向。
完整对比见 [Policy Models](policy-models.md)。

实体与阶段见 [Architecture](architecture.md)；声明面见 [Library](library.md)；
CLI 权限模型见 [CLI](cli.md)；互相冲突的真实场景见 [Use Case](use-case/README.md)。

## 要解决的问题

同一种字节变化没有固定业务含义：

- Eval 注释变化通常不影响证据，但 prompt 注释可能就是题面。
- `.env` 中的 URL 可能只是新隧道，也可能指向另一套被测服务。
- Sandbox setup 改 URL 可能只是换路由，也可能换了工具下载源或数据集。
- 外部资源完全没改，但 observer 暂时失败，系统只能得到未知。

框架不能从路径、变量名或字符串形状推断意图。
候选设计把判断拆成三层：

1. **角色。**作者声明一个值是行为条件、连接坐标、凭据还是资源身份。
2. **事实。**系统保存完整 manifest、resource observation 与精确 delta。
3. **政策。**默认严或默认松，并允许用户对当前计划作有边界的收紧或放宽。

## 共同不变量

无论最终选择哪套默认政策，都遵守这些边界：

- model、Agent 行为参数、Eval 输入、判定逻辑和 Sandbox 起步环境属于行为条件。
- secret 永不落明文；连接坐标不因自身变化自动代表资源变化。
- 资源身份由 observer、静态 epoch 或内容地址表达，不能从 URL 猜。
- `attempts`、并发、预算等目标数量或编排变化不改变已有 Evidence 的行为身份。
- 完整事实与 delta 落盘；hash 只负责查找，不能替代解释。
- 放宽判断只能接受当前计划中的精确原因，不提供永久路径 ignore 或任意 glob。
- 收紧判断可以按 verdict、Eval 或依赖原因扩大重跑范围，不改 Experiment 的长期身份建模。
- Evidence 的真实执行来源不改写；复用和人工授权只增加来源边。

## 用户拥有的权限

用户不是只能在“相信框架”和“全部重跑”之间二选一。
CLI 提供两类对称权限：

- **收紧：**`--rerun <selector>`，让本次少采信、多派发。
- **放宽：**`--accept <reason>`，让本次多采信、少派发，并记录精确授权。

`--accept` 可以覆盖源码、条件、Sandbox 或资源差异，也可以覆盖某个明确的 opaque 原因；
风险通过计划、作用域与落盘记录暴露，而不是由框架替用户禁止。
它不能接受缺失 Evidence、非终态结果或 secret 值，也不能形成未来变化自动通过的永久规则。

## 为什么仍需要角色声明

CLI 授权适合例外，不适合每天重复表达稳定语义。
`.env` 中的 URL 如果长期只是连接坐标，应在 Library 中声明为 connection，并为背后的资源提供身份。
如果 URL 本身区分两套被测实现，应声明为 condition。两者不能靠一个全局 ignore list 混过去。

角色声明决定正常路径，CLI 授权处理一次例外；两者职责不同。

## 待裁决

1. 产品默认采用证明优先还是复用优先；是否允许在项目配置中选择，还是全产品只能有一个默认。
2. `--accept` 对 opaque 原因是否必须同时传 `--reason <text>`。
3. 条件和 Sandbox 差异的人工授权是否需要二次确认；CI 中如何非交互确认。
4. observer 失败在证明优先下是派发还是阻塞；在复用优先下是否必须产生高可见诊断。
5. 同一 Invocation 中部分 Eval 接受、部分 Eval 重跑时，selector 语法是否足够清晰。

## 相关阅读

- [Policy Models](policy-models.md) —— 默认严与默认松的完整对比。
- [CLI](cli.md) —— `--rerun`、`--accept`、计划原因和作用域。
- [Library](library.md) —— condition、connection、secret 与 resource identity。
- [Use Case](use-case/README.md) —— 注释、`.env` URL、Sandbox 与外部状态的冲突矩阵。
- [当前缓存契约](../../feature/experiments/cache.md) —— 已定稿实现仍遵循的两层 hash 与六道门。
