# 裁决:telemetry 配置失败保持 errored,不降级

- **裁决**(2026-07-30):沙箱侧 OTLP 采集器写不进 `/tmp`(permission denied)这类
  telemetry 配置失败,attempt 保持 `errored`,不降级成 warning,也不静默继续。
- **曾选方案一(否决)**:降级为 attempt 级 warning + trace 标 unavailable,判定照常。
  否决理由:环境缺陷被消音后永远没人修,残缺环境跑出的终态还会被携带固化。
- **曾选方案二(否决)**:接收器起不来不阻断,事件流真走 OTLP 的 adapter 由
  EvidenceCoverage 机制自然折成 errored(「该错就错」)。否决理由:`/tmp` 不可写说明
  镜像本身坏了,装依赖、跑测试迟早也撞;大声错 + errored 不携带,修好镜像重跑即自愈,
  而按消费面放行会让无关缺陷藏到更晚才炸。
- **定稿义务**(契约已落):provider 可写保证扩到 runner 的沙箱侧运行时路径
  (docs/feature/sandbox/architecture.md「provider 的可写保证不止 workdir」段);
  报错点名不可写路径与修法,不透传 SDK 原始错误串;超时类同病见
  docs/error-feedback.md「超时报错的三要素」。
- **出处**:MemoryBench dogfooding(2026-07-30),huarong-dao-solver 死在
  configuring telemetry;下游诉求「旁路采集失败一律降 warning」被打回,
  答复=修 fixture 镜像的 `/tmp` 权限。
- **报错落点**(2026-07-30 已实现):`src/o11y/otlp/sandbox-receiver.ts` 对权限类失败
  (EACCES/EPERM/EROFS,含 e2b 500 体内的 permission denied)报 `o11y.sandboxTempNotWritable`,
  点名采集器路径 + 镜像缺陷 + 修法,原始串只进 cause;「上传成功但端口永不出现」的第二症状
  也经一次可写性探针归入同一报错。
