# 目标与要求

**相关文档**：[README](README.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3（未采用）](PLAN-3/README.md) · [DECISION](DECISION.md)

## 目的

让一个现有 NiceEval 项目的 Eval 在其它 NiceEval 项目中复用。
发布方继续维护同一棵 Eval 源码和资产，消费方为每道要纳入的题写一个独立 Eval 文件。

远程 Eval 文件是消费项目自己的发现入口。
它引用上游的一道原生 Eval，不创建第三种题目对象。

## 核心要求

### 发布方零共享协议新增

1. 一个已能运行的 NiceEval 项目不需要新增共享入口、manifest、配置字段或生成输出。
2. 发布方现有的 `defineEval`、`defineScoreEval`、Sandbox、Assertion、项目内依赖模块与资产原样运行。
3. 发布项目自己的 `niceeval.config.ts`、Experiment 与 Agent 不进入消费项目。

所选 Git/package 内容仍必须自包含，普通运行期 dependency 仍须正确声明；这是可安装项目的基本条件，不是共享专用 API。

### 消费方显式登记

4. 消费方用一个文件级 `defineRemoteEval` 引用一道上游 Eval，不复制题目目录，也不改写上游源码。
5. 远程 Eval 文件的路径形成项目内 Eval id；package name、root 或上游 id 不自动成为前缀。
6. 已安装但没有远程 Eval 文件引用的 package 完全不可见，不能改变项目 catalog。
7. 不新增 `remoteEvals` 或其它配置集合，也不建立自动扫描、include 或排除规则。

### 项目所有权

8. 消费项目拥有远程 Eval 文件和项目内 id，上游 package 拥有被引用的 Eval 定义及其运行输入。
9. Agent、model、attempts、flags、Judge、预算与运行选择继续由消费项目决定。
10. Experiment 沿用现有 `evals` selector；它不分 project selector 与 remote selector。
11. 消费项目不能 patch 或 override 上游 Eval；需要改变题目时应升级或 fork 上游。

### 可复现与归属

12. 外部 Eval 代码、资产与传递依赖由消费项目的 package manager 和 lockfile 固定。
13. 运行前必须验证直接 dependency、lockfile 选择、物理安装路径和远程 source identity 的唯一对应关系。
14. Run 与 Attempt 必须保存去凭据后的 definition provenance 和 execution provenance。
15. 普通运行不联网、不更新依赖，也不改写 package 声明或 lockfile。

### 携带边界

16. 初始契约把 package identity 作为整个远程题集合的携带边界。
17. 同一 package identity 下继续应用普通的运行资格检查；package identity 改变时，该 package 的全部远程 Eval 都失去携带资格。
18. 逐题跨 package 版本的 source、dependency 与 transfer 对比不属于这个契约；它可在独立设计中加入。

### 原生兼容与安全

19. 在受支持的 Node/模块矩阵内，上游 owner 中的 `niceeval` 与 `niceeval/*` import 使用消费项目正在运行的 NiceEval 实例。
20. 上游的相对 import、Fixture、Sandbox 输入和运行期本地路径必须留在上游 package owner 内。
21. 外部 Eval 是受信任的可执行依赖；owner containment 防止意外路径逃逸，不构成恶意代码安全沙箱。

## 非目标

- 不把 Harbor、Inspect 或其它格式转换成 NiceEval。
- 不建立 NiceEval 托管 registry、账号、权限、计费或镜像服务。
- 不替 npm、pnpm、Yarn 或 Git 决定版本和安装依赖。
- 不要求发布方维护共享专用 metadata 或 release。
- 不从已安装 package 自动发现 Eval，也不因 package 升级自动增加项目 Eval。
- 不为远程 Eval 增加专用 Experiment、selector、结果格式或配置集合。
- 不让消费项目静默覆写外部题；需要改题时使用 fork 或新的 package 上游。
