# 设计裁决:否决 sandbox.native 原生出口与「透明转发未知方法」

**裁决**(2026-07-31):不给 eval / Layer 作者暴露 `sandbox.native`;不承诺「包装层透明转发所有未知方法」这种公共语义。采纳的窄契约是:core 已知、但不属于中性 `Sandbox` 接口的内部能力(suspend/resume 这类)必须显式建模为 capability 成员,所有包装/装饰实现有义务保留并转发它们(落 `docs/feature/sandbox/architecture.md` 实现纪律)。

**曾选方案**:suspend 假成功事故后有提案认为根因是「封闭接口 + 包装层」结构性吃掉非接口能力,主张补 `sandbox.native: unknown` 出口 + 包装层透明转发未知方法。

**否决理由**:

- 三次事故不同因:suspend 被 `normalizeSandboxPaths` 包装吃掉是「内部能力未显式建模」;vercel sandboxId 取错字段、e2b paginator 形状猜错是「对原生 SDK 契约映射/验证错误」——后两类给了 native 出口照样发生。
- native 出口绕开命令 deadline、timing、路径归一化、重试、资源组回收与 author-facing 生命周期权限(`t.sandbox` 不暴露 `stop()` 是明文契约),等于开了一条不受管旁路。
- `native: unknown` 对 TS 用户只是鼓励 cast:换 provider 后 cast 照样编译通过、运行时炸;`Sandbox<TNative>` 泛型则要穿透 defineEval,破坏「eval 独立于 provider」边界。
- 「透明转发未知方法」无法稳定测试(Proxy/原型/private fields 各有语义坑),不是可承诺的公共契约。
- Layer 若调 native 就不再跨 provider 复用,与环境层设计目标直接冲突。

**适用场景**:再有「上游 SDK 有能力但 `Sandbox` 接口没有」的需求时,路径是显式 capability(接口成员或 case 能力句柄,如 `ServiceController`),同时给包装层加保留义务;不是开逃生口。
