# Package：安装后的外部消费

Package Repo 只保留无法由其它功能 Journey 自然证明的安装边界。根 runner 把待发布 tarball 安装进仓库外副本；测试只从
安装后的 `niceeval` binary 与 package exports 进入，不引用 checkout 源码或构建目录。NiceEval 的 CI 只使用 Node 24，
不建立跨 Node 版本兼容矩阵。

## Owner 表

| Owner ID | 用户结果 | 形态 | 文件 | Lane | 历史 bug |
| --- | --- | --- | --- | --- | --- |
| [`#package-commonjs-init-list`](#package-commonjs-init-list) | 默认 CommonJS 项目可消费公开 Host SDK，并用安装后的候选包完成 `init → list` | Journey E2E | `e2e/package/test/package.test.ts` | PR / release | `b44420d3` |
| [`#package-bub-e2b-template`](#package-bub-e2b-template) | 安装后的 E2B factory 为默认 Bub 生成固定模型客户端闭包及匹配 marker | 单边界 E2E | `e2e/package/test/bub-e2b-template.test.ts` | PR / release | `bub-default-client-closure-drift` |

## package-commonjs-init-list

用户用包管理器初始化项目时，`package.json` 默认不声明 `type`。该项目包含一个同时导入 `niceeval` 与
`niceeval/expect` 的 Eval；安装后的 candidate 先执行 `init` 生成 `niceeval.config.ts`，新的 CLI 进程随后执行 `list`，
并必须发现该 Eval。

这条 Journey 会直接杀死历史回归的任一半：bin 未注册 tsx CJS hook 时，用户 `.ts` 无法转译；exports 缺少 `require`
条件时，config 或 Eval 无法加载包入口。两种错误都在 `list` 的进程结果上变红，不再通过 Unit 读取 bin 源码或
`package.json` 结构间接猜测。

同一安装边界还核对候选包的四类 dependency 字段都不声明 `@niceeval/testkit`，且 tarball 不含 `packages/testkit`。
这是防止私有测试设施泄漏进产品包的 checkpoint，不另建 Testkit owner。

同一 consumer 还通过 ESM `import` 与 CommonJS `require` 加载 `niceeval/eval/host`、`niceeval/project/host`。
测试核对两种模块系统共享冻结的 Host 对象，并且 Project 入口只交付调用者组合所需的 capability tags，不暴露 Node Live Layer。

## package-bub-e2b-template

用户从安装后的 `niceeval/sandbox/e2b-template` 调用 `e2bCodingAgentTemplate("bub")`，再通过 E2B
`TemplateBuilder.toDockerfile()` 取得实际构建输入。构建输入必须同时固定 Bub、`any-llm-sdk` 与 `openai`，
并写入与默认 `bubAgent()` 相同的安装 marker；漏掉任一传递依赖或仍按旧闭包计算 marker 都会使本 owner 变红。

这条单边界测试不连接 E2B、也不声称模板已经发布；外部 provider 的构建与发布仍走维护者发布流程。它只证明安装后
factory 交给 E2B 的公开构建输入可复现，且不会因 identity 分叉强制 Adapter 每次重装。

## 不重复建立的测试

- ESM 根入口与其它实际功能子路径由 CLI、Runner、Record、Report、Lifecycle 和 Adapter 的真实 Journey 自然消费；Package Repo
  不再按 ESM / CJS / 无 `type` 各写一条只检查 `typeof` 的 smoke。
- Release workflow 对待发布的同一 tarball 执行 native runtime smoke；Package Repo 不再复制一套从 candidate exports
  反推 expected 的遍历器。
- 不用静态 import 清单与 candidate exports 做 parity，也不扫描 bin 源码、Cmd 字符串或构建目录。新增公开入口时，
  由拥有该入口用户结果的功能 Journey 消费它。
- 可选 peer 缺席只有在场景确实不安装该 peer、且用户动作会经过相关入口时才成立；不能在 peers 全部已安装的 Repo 中用标题冒充。

## 安装与身份

Package Repo 本身是候选包的外部 consumer。根 runner 负责 candidate digest、lockfile integrity、executable 身份与隔离副本；
测试正文不另建未安装 candidate 的第二套消费图。Release 与 E2E 独立；发布只 pack 一次并在 publish 前复核同一 tarball，不在发版时重跑消费验收。

具体编译器、bundle/chunk 数量、私有目录布局、CLI flag 全矩阵、provider 协议和浏览器交互不属于本 Repo。
