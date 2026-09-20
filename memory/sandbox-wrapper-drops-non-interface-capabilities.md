---
format: concord.document/v1
id: sandbox-wrapper-drops-non-interface-capabilities
title: 包装层静默丢弃非接口能力:suspend 之后 ensureLifetime 第二次复发
createdAt: 2026-07-29T22:20:07+08:00
createdAtSource:
  kind: first-recorded
  path: memory/sandbox-wrapper-drops-non-interface-capabilities.md
  commit: 2560d733e14dbbfc77bec57cd7dc5810f0023db2
kind: memory
memoryKind: problem
state: resolved
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "- 已修 [sandbox-wrapper-drops-non-interface-capabilities](sandbox-wrapper-drops-non-interface-capabilities.md) — normalizeSandboxPaths 丢非接口能力 ensureLifetime,suspend 之后同 bug 第二次复发;修为显式转发+穿透断言,新增 provider 能力必查全部包装层"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# 包装层静默丢弃非接口能力:suspend 之后 ensureLifetime 第二次复发

- **现象**:`normalizeSandboxPaths` 包装 Sandbox 时只转发 `Sandbox` 接口方法,
  provider 自己实现的非接口能力(`ensureLifetime`)被静默丢弃——若不修,复用能力探测
  永远探不到,与 [keep-sandbox-suspend-silently-broken-for-all-providers](keep-sandbox-suspend-silently-broken-for-all-providers.md)
  丢 `suspend()` 是同一个 bug 的第二次复发。
- **根因**:包装层按接口形状重建对象,接口之外的能力方法不在重建清单里;
  类型系统不报错,因为能力本来就是可选探测的。
- **修法**(2026-07-29):`src/sandbox/paths.ts` 显式转发 `ensureLifetime`,
  `src/sandbox/paths.test.ts` 断言能力穿透包装层。**模式教训**:每新增一个 provider 能力,
  必须同批检查所有 Sandbox 包装层(paths、retry 等)是否转发,并配一条穿透断言;
  这是第二次踩,第三次之前考虑把能力收进接口或统一用 Proxy 转发。
