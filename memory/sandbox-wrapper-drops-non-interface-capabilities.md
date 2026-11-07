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
