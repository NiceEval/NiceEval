# 目标与要求

**相关文档**：[README](README.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [DECISION](DECISION.md)

## 目的

让一个现有 NiceEval 项目的 Eval 在其它 NiceEval 项目中复用。
发布方继续维护同一棵 Eval 源码和资产，消费方为它选择 Agent、model、Experiment 与项目内 id 前缀。

消费项目把另一个已安装项目中的目录加入 Eval 发现根集合。
共享机制不引入新的题目对象；发现出来的成员仍是普通 EvalDefinition。

## 核心要求

### 发布方零共享协议新增

1. 一个已能运行的 NiceEval 项目不需要新增共享入口、manifest、配置字段或生成输出。
2. 发布方现有的 `defineEval`、`defineScoreEval`、Sandbox、Assertion、项目内依赖模块与资产原样运行。
3. 发布项目自己的 `niceeval.config.ts`、Experiment 与 Agent 不进入共享契约。

所选 Git/package 内容仍必须自包含，普通运行期 dependency 仍须正确声明；这属于可安装项目的基本条件，不是共享专用 API。

### 消费方零转换

4. 消费方不写格式适配器，不生成 wrapper Eval，也不复制题目目录。
5. 消费方只声明已安装 package、其中的 Eval root 与项目内挂载前缀。
6. 外部 Eval 中的普通 import、相对 URL、loader 与 folder-local 目录语义保持不变。

### 项目所有权

7. 消费项目决定挂载前缀；最终 Eval id 仍是项目内身份。
8. Agent、model、attempts、flags、Judge、预算与运行选择仍由消费项目决定。
9. NiceEval 不装载发布项目的配置或 Experiment。

### 可复现

10. 外部 Eval 代码、资产与传递依赖由消费项目的 package manager 和 lockfile 固定，并把逐 Eval 可达身份投影进 NiceEval manifest。
11. 普通运行不联网、不更新依赖，也不改写声明文件。
12. Run 能指出一条 Eval 来自哪个 dependency、精确 commit/integrity、哪个 root 和挂载点，并区分 definition provenance 与 execution provenance。

### 精确失效

13. 依赖升级只让 source、可达 dependency、runtime、Sandbox 或 transfer 输入改变的 Eval 失去携带资格。
14. 只改 README、发布项目配置或另一条无关 Eval，不作废当前 Eval 的结果。
15. 外部根中一个项目内模块改变时，只作废静态 import 它的 Eval；无法完备查明的动态依赖保守地禁用携带。

### 组合

16. 本地 `evals/` 与多个外部根进入同一发现结果、选择器和 Record 读取面。
17. 本地 Eval id 与挂载后的外部 Eval id 冲突时，发现阶段一次列全并拒绝运行。
18. 同一个外部项目可被不同消费项目挂到不同前缀，不要求它们使用同一份 Experiment。

### 原生兼容

19. 在受支持的 Node/模块矩阵内，外部 owner 中的 `niceeval` 与 `niceeval/*` import 使用消费项目正在运行的 NiceEval 实例。
20. 发布项目不能因本地 devDependency 或 workspace link 意外带入第二个 NiceEval 运行时。
21. Node linker 能识别缺失 export 时，发现阶段按 package 文件报兼容错误；运行期动态访问保留带 package provenance 的普通错误。

### 安全与归属

22. 挂载外部 Eval 根与安装并执行第三方代码同级，出处必须在人读与机器读入口可见。
23. 外部 Eval 继续经过隐藏输入泄漏检查，package 边界不能放宽资产隔离。
24. package 的 name、version、repository 与 license 提供基础归属，不替用户判断法律许可。

## 非目标

- 不把 Harbor、Inspect 或其它格式转换成 NiceEval。
- 不建立 NiceEval 托管 registry、账号、权限、计费或镜像服务。
- 不替 npm、pnpm、Yarn 或 Git 决定版本和安装依赖。
- 不要求发布方维护共享专用 metadata 或 release。
- 不把共享项目的 Experiment 当成消费项目运行配置。
- 不让消费项目静默覆写外部根里的单题；需要改题时使用 fork 或新的 package 上游。
