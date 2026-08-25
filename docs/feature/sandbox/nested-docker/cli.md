# Nested Docker —— CLI

nested Docker 的公开诊断入口是 `niceeval sandbox provider doctor incus`。
它默认检查 reference domain，不把 development 绿灯当成 reference 通过。
doctor 只读，不 create、不 destroy allocation。

## `doctor incus`

公开语法：

```bash
niceeval sandbox provider doctor incus [--development]
```

```bash
niceeval sandbox provider doctor incus
niceeval sandbox provider doctor incus --development
```

默认只读检查 reference：execution domain、dedicated block-backed attested capacity、trusted image 与 inventory。
它不执行 cleanup，也不操作 Eval allocation。

`--development` 是另一条命令面，只检查 development domain 与 `storagePool` `niceeval-sandbox-dev`。
两条命令各自给出自己的通过或失败。
development 通过不能遮住 reference 失败；reference 通过也不暗示 development 可用。
`--development` 通过也不把容量写成 attested，或把结果标成 reference comparable。

doctor 发现损坏时只登记 exact quarantine 建议。
只有 reconciler 能根据 durable ownership 执行 destroy。
doctor 自身不通过顺手 cleanup 改变被诊断现场。

## 默认 reference

未带 `--development` 时，doctor 只接受 dedicated block-backed、可 attestation 的 reference capacity。
loop-backed pool、目录伪装、共享可写 Docker data 都失败。
pathname 或 `findmnt` 文本单独不构成通过。

`--development` 只证明本机开发例外存在。
它不是 reference，也不能让未写 `acceptDevelopmentDomain: true` 的 Experiment 过 planning。

## `--dry` 与 identity

```bash
niceeval exp <experiment> --dry
```

`--dry` 显示 exact Docker requirement、Incus capability receipt、execution domain 与
`acceptDevelopmentDomain`。
省略该字段时输出按默认 `false` 呈现，并与显式 `false` 使用同一 identity。
写出 `true` 时，dry run 必须显示 `capacity._tag === "Unattested"`，并把 development domain 标成 non-comparable。

`--dry` 不调用模型，不创建 Eval allocation。
requirement 与 capability 不匹配时，在 fingerprint 前以 `sandbox-capability-unsatisfied` 失败。

## 不提供的命令

nested Docker V1 不提供：

- `niceeval docker profile list|doctor|exec` 作为 adopted nested-Docker 诊断；
- 用 development doctor 替代 reference doctor；
- doctor 的 create / destroy allocation；
- `--keep-sandbox` 与 `incusSandbox()` 的组合；
- 让 CLI 在宿主上 mount、loop、nft、sudo、build、import 或 pull image。

旧 `niceeval docker profile *` 属于待移除的实现缺口，见 [Docker Profile CLI](../docker-profiles/cli.md)。
