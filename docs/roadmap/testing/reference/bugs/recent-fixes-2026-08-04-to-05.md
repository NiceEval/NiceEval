# 2026-08-04 至 2026-08-05 修复覆盖审计

本审计读取这两天 `fix(...)` 提交的真实 diff，不把“每个 fix 必须新增一条测试”当目标。判据是：同类错误是否
已有唯一 owner；若已有，只扩大其有区分力的 scenario；若只是测试防抖、文案同步或误提交回滚，不制造产品
Behavior。

## 结论

原方案能接住进程交付、历史 identity、Report 语义、lease / cleanup 等主干风险。它漏了四个明确地面：无 optional
peer 的冷启动消费者、官方 sandbox 基线、Report 可视编码、源码控制字节完整性；Site 的 discover → read 用户任务也
不在原题库内。本轮将它们收敛为 A2 / A7 的 scenario 扩展、一个 sandbox Behavior、一个 Site Behavior 与三个
机制 owner，不按 commit 数量新增测试。

## 映射

| 修复 | 逃逸形态 | 目标 owner | 本方案动作 |
|---|---|---|---|
| `90305b2a`、`57d0f153`、`775816b3`、`7812fd41` | batch accept 丢 `selectedEvalIds`；run / carried 的 `configHash` 或 Judge 解析链分叉 | A3 历史与 identity 往返；carried / fingerprint 唯一机制矩阵 | A3 动作序列加入 batch accept 后再读 view 与 carry；不另起四条回归测试 |
| `304f18cb` | config delta 在构造点被截断，身份比较收到伪数据 | carried / config identity 矩阵 | 在同一机制矩阵加入长而后缀不同的值；Human 只留一个接线代表 |
| `0193b29f` | 安装包在未安装 `dockerode` / `e2b` 时冷路径静态 import 崩溃 | A2 发布包消费方矩阵 | 增加 `minimal-no-optional-peers` scenario；仍只有一个 Behavior owner |
| `94ae46d6` | Chart 类型分支令候选包 `prepare` / `tsc` 失败 | A2 候选消费；U6 Report contract | consumer prepare 必须运行候选包类型检查；不靠工作树 TS 通过替代 |
| `89307454` | 24 个 series identity 被压成 6 种可视 mark | A7 Report 双面语义；U6 可视编码矩阵 | Unit 穷举 24 identity 唯一编码，浏览器只留多于 6 个的代表闭环 |
| `7fae6b5e` | compare stale / reference parity 与 coverage composition 层级错位 | A7；U6 compute 非对称 fixture | 扩大既有公式 / 组合 owner，不新增 snapshot 或独立 Behavior |
| `cbac5659`、`db19c31b`、`8aa93382`、`226303f2` | 官方镜像非 root、recipe revision、`/usr/local` 写权限、PATH / `pathPrepend` 声明与执行脱节 | A10 官方 sandbox 契约；U10 baseline matrix | 一个真实官方环境代表闭合声明与执行；全 recipe / provider 组合由结构矩阵拥有 |
| `b050b12b` | root reuse guard 到派发后才失败；reset 失败无诊断 | A1 失败交付、A9 资源闭合、U2 lease / pool 矩阵 | 在既有 owner 增加 pre-dispatch 与 reset failure case，不新建 sandbox-reuse E2E |
| `5b27d054` | Compose CaseKey 名称把配置身份误称本地 digest | U10 sandbox identity schema | 只守字段语义和稳定身份，不把内部字段名做 E2E 文案契约 |
| `f07c6a30` | TS 源码落入 literal U+0000 | U11 source text integrity | 静态扫描受发布源码与生成 TS 的非法控制字节；不启动 CLI E2E |
| `acb43e36` | blog 首页只列部分文章；正文 markdown 链接不可点击 | A11 Site discover → read | 一个本地生产构建 / 浏览器主证明，使用两篇代表和一个 markdown link；不逐文章复制 |
| `f83d9bed`、`e7cb6d1d` | 测试本身读 wall clock；lock / gate fake-clock flaky | U2 可控时间 / lease 设施 | 这是测试确定性修正；统一禁止 wall-clock 阈值和未驱动 fake timer，不新增产品 Behavior |
| `2e13dc6e` | E2E 对 unknown flag 的旧措辞过拟合 | 无新增 owner | 精确 parseArgs 文案不是新产品风险；已有 CLI 用法错误契约保留一个领域断言，其余字面副本删除 |
| `a0734a8a` | init 成功提示重复托管路径 | 既有 CLI feedback owner | 只保留“单一可执行下一步”的领域断言，不为一行文案留 snapshot |
| `e8516dfa` | 撤回误带入的并行未完成改动 | 无 | 不是产品缺陷形态，不产生 proof |

## 新增 owner 的最小边界

- A10 只跑一个官方 Node sandbox 代表，证明运行用户非 root、`/usr/local` 可写、`pathPrepend` 在真实命令生效且
  execution identity 与声明一致；provider / recipe 全组合留在 U10。
- A11 只证明用户能从完整 blog index 进入一篇文章并跟随正文 markdown link；文章数量、locale 与链接解析的
  组合在 Site 结构 unit 中穷举。
- U10、U11 与 U6 扩展都必须声明具名错误算法；没有第二个独立算法时不再拆 proof。

其余旧测试不要求 100% 映射。实施者先落目标 owner，再删除重复 snapshot、相同矩阵的多投影副本和只断内部
DTO 形状的测试；覆盖率数字不构成保留理由。
