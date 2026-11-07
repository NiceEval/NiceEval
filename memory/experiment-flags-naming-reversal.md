# 设计裁决:experiment 条件键定名 flags(经历 flags→params→flags 翻案)

- **裁决**(2026-07-10,commit 3265d4f):运行时链路 `experiment.flags → ctx.flags → t.flags` 定名 `flags`,持久化字段同名,`schemaVersion: 3`。
- **曾选方案**:同日早先曾以「与 CLI flag(`--report`、`--transcript`)撞词、flags 暗示布尔」为由,把整条链路改名 `params`(`schemaVersion: 2`)。
- **否决理由**(用户同日翻案):这个字段的语义就是产品 A/B 测试里的 feature flag——一个 experiment 是一组 flag 取值,A/B 域的 multivariate flag 本来就装任意 JSON;「flags 暗示布尔」只在 CLI 域成立。撞词靠行文约定解决:裸词 flags 一律指实验 flags,命令行开关一律写「CLI flag」或字面 `--xxx`(术语约定见 `docs-site/AGENTS.md` 术语表)。
- **两次改名共同确立的原则**:持久化字段改名是破坏性变更,递增 schemaVersion;不做旧字段名读取别名——归一就是一次小型迁移,「不解析、不迁移、不猜」无例外。旧落盘按版本规则进 `skipped("incompatible-version")`,producer 提示 `npx niceeval@<版本> view` 兜底。版本序列见 `docs/results-format.md`。
