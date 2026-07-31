# Environment 与 Provision 取代 materializer 与 Layer

## 裁决

2026-07-31,重环境公开模型改为四个正交概念:Eval Environment、实际执行空间 Sandbox、Experiment Provision 与 workdir Fixture。

- `composeEnvironment()` 只声明题目条件,`dockerSandbox()` 选择 Provider 并内建 Compose 支持。
- 普通用户 API 删除 `materializers` 与 `dockerComposeMaterializer()`。
- `defineLayer` / `experiment.layers` 改为 `defineProvision` / `experiment.provisions`。
- Provision 用 `inspect` 返回实际 identity,框架比较目标 identity;缺失或不匹配时 `install`,随后复检。
- `sandboxReuse` 只表达跨 Attempt 状态边界,不再作为重安装的默认优化。
- `CaseKey` 改名为 `EnvironmentKey`;Provider 生成的计划与运行资源组只作为内部 Environment Plan / Running Environment。
- 自定义后端声明改为 `defineSandboxProvider()`,避免 `defineSandbox()` 把 Provider 与运行实例说成同一个对象。

目标设计在 `docs/roadmap/environment-model/`。

## 推翻了什么

本裁决推翻 `env-cases-and-ensure-supersede-topology-middleware.md` 中「`environments` 与 `materializers` 双入口」的公开配置形态。
Provider-specific environment case 与构建协调仍保留为内部职责,但 Provider 原生支持的 Environment kind 不要求 Experiment 作者手工注册转换器。

本裁决也推翻 `layer-state-on-hooks-not-on-layer.md` 所依赖的 Layer 公开模型。
其中「安装与状态是两类职责」继续成立:安装进入 Provision,跨 Attempt 状态留在 Sandbox Hook。

## 为什么改判

旧模型从 Runner 实现出发,把 source、case、materializer、Layer stack、agent Layer 与 Hook 同时交给用户。
每个对象都能解释,但用户必须先理解执行引擎,才能写出「Docker 跑 Eval 自带 Compose」或「给 Experiment 安装 mempal」。

`dockerComposeMaterializer()` 尤其没有增加用户选择。
Eval 已声明 Compose,Experiment 已选择 Docker,再次注册「Docker 能运行 Compose」只是手工接线。

Layer 的 `check: { ok: true }` 也无法从形状上保证它检查了完整 identity。
改成 `inspect` 返回实际 identity 后,模型版本、配方 revision 与 payload digest 是否一致由框架比较,不会只靠作者纪律。

## 保留的不变量

- Eval 不选择 Provider。
- 每个运行环境只有一个主 Sandbox,Agent、测试、workdir 与 diff 锚定同一执行空间。
- Provider 不支持合法 Environment kind 时计划期 `skipped`;配置非法仍是启动期错误。
- BuildKey 只管构建复用,EnvironmentKey 管完整题目环境身份。
- 稳定预装内容仍需运行时检查,不按 template 名短路。
- 安装不写 workdir,Fixture 才写 workdir。
