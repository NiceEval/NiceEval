# 设计裁决:发布脱敏管线整体移除,`view --out` 无确认关卡

## 裁决

2026-07-16,用户裁决移除发布脱敏功能:`copySnapshots` 的 `redact` 必填参数、schema 的自由文本标注体系、`snapshot.json` 的 `publish: { redaction }` 标记、`view --out` 的发布防呆与 `--allow-sensitive-artifacts` flag、实体列表 data 函数的展示层 `redact` 选项,一并退场。`copySnapshots` 退化为纯粹的挑快照 + 挑 artifact + 携带证据归拢 + 50 MiB 预检,artifact 原字节复制;`view --out` 是裸复印机。保密边界由格式在**采集侧**划定:时间树命令证据只存有界脱敏摘要,env 值与命令 stdout/stderr 不进 `result.json`(这条采集侧不变量**保留**,与本裁决无关)。

## 曾选方案与否决理由

- **`redact` 必填表态**(函数消毒或显式 `false`,2026-07 前的定稿):否决——实测真实结果根(coding-agent-memory-evals,八种凭据模式 + env 赋值 + Authorization 全扫)零秘密,原因是采集侧不变量已把运行环境注入的秘密挡在结果文件之外;发布侧的正则消毒由作者手写、无担保(契约自己承认「函数没改干净的秘密它不担保」),防呆却在每次导出索要确认、每个新字符串字段索要标注,纯仪式成本。
- **保留展示层 `redact`(实体列表)**:否决——它与发布消毒共用自由文本标注表,发布侧删除后它是标注表唯一消费者,且定位本来就是「不能当发布脱敏用」的半吊子。
- **兜底方向**(未做,将来要做就走这条):按已知凭据模式「只警告不改写」的导出扫描(同 e2e-ci 上传前按注入 secret 值扫描的思路),不复活 redact。

## 落点

docs:`docs/feature/results/library.md` 复制小节、`docs/feature/reports/view.md` 静态导出、`results/architecture.md` schema、`entity-lists.md`;src:`results/copy.ts`、`results/publish.ts`(只剩预算常量)、`results/types.ts`、`view/{data,index,server}.ts`、`cli.ts`、`report/{types,compute,components,index}`。
