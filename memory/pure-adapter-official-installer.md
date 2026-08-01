# Adapter 纯适配:ensure 声明归 Adapter,安装归官方 Agent 安装层

## 裁决

2026-08-01(用户定案):Sandbox Agent Adapter 回归纯协议适配。Adapter 在 Sandbox 内只保留一份 `ensure` 声明(`AgentEnsure`:目标 identity + 只读 probe);安装实现拆出为官方 Agent 安装层(`AgentInstaller`),按 ensure identity 配对,拥有 staged payload、平台探测与安装模式。Runner 在 `agent.ensure` 相位组装循环:probe → 未命中由配对安装层 install → 复检。作者面零变化:安装仍随 agent 选择自动接线,Agent layer 仍 command-only、永远最后、不能带 template。

命名同批统一为 probe / install / ensure 词族:probe=只读探测(零件),install=安装动作(零件),ensure=两者组成的循环(`installTool` 是工具版,`agent.ensure` 是 Agent 版)。相位 `agent.provision` 更名 `agent.ensure`,同时消除与 sandbox provisioning(实例创建重试机制)的撞词。

## 曾选方案

- 维持 AgentProvisioner:identity / inspect / install 原子值对象,整体住在 Adapter 包内。
- Adapter 检查命名 health(用户当场否决,统一进 ensure/probe 词族)。

## 否决理由与翻案关系

部分替代 [[agent-provisioner-object-not-adapter-methods]](2026-07-30):当时否决「在 SandboxAgentDef 上散布方法」并要求 check/install 原子替换,担心的是两者版本漂移。新形态用 identity 配对保留该保证:安装层按 Adapter 声明的 identity 选择、版本常量同源(与预制环境「命中预装与回退安装装同一版」同一规则),identity 对不上时 probe 大声失败,不静默。新事实是内置 prepare 命令机制(2026-08-01 定稿)给了 install 更好的家;协议与安装的变化轴分离让第三方 Adapter 可以只写协议——probe 未命中且无配对安装层时报明确出路(预制环境,或作者在 Experiment layer 用 `installTool` 自装)。

## 落点

契约:`docs/feature/adapters/architecture/agent-ensure.md`(主页)、`docs/feature/sandbox/layers.md` Agent layer 节、`docs/feature/sandbox/lifecycle.md`;词条在 `docs/concepts.md`。
