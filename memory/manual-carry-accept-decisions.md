# 手动复用标记定稿的四条裁决

日期:2026-07-30。背景:全局 judge model 改名把 6 题里 5 道不用 judge 的题一起作废,
用户要「手动允许重跑与允许不重跑」的对称权限。定稿落
`docs/feature/experiments/cache.md`(manifest、`--accept`)与 `cli.md`(`--dry` 原因、TTY 标记)。

## 裁决 1:放宽是重锚,不是持久 tag,因此没有过期问题

- **裁决**:`--accept` 沿用 `--carry-ignoring-flag` 的重锚机制——被授权携入的条目按本 Run
  口径重打指纹,下次自然命中;授权记录(`carriedAccepting`)随条目落盘。
- **曾选方案**:给条目打持久 tag + tag 过期时间(用户提出「多久过期」之问)。
- **否决理由**:持久 tag 是 standing rule,等于永久 path ignore(roadmap 明确堵死);
  TTL 引入时间驱动的作废,而整套契约是变化驱动的——「太旧要复验」是人的收紧判断,走 `--rerun`。

## 裁决 2:`--carry-ignoring-flag` 被 `--accept config:flags.<key>` 吸收

- **裁决**:删独立 flag,键的增删就是一条 config 差异,机制从两套并一套。
- **否决理由**:原 flag 的「只接受已不在 flags 里的键」约束被通用校验覆盖
  (selector 必须命中计划里真实存在的差异);beta 无兼容包袱。
- **代价与新面**:原设计禁止「抹掉仍生效的实验条件」以防混 configHash;`--accept` 允许
  accept 值变化差异——风险显式交给人,`carriedAccepting` 留审计,报告混账可事后追认。

## 裁决 3:roadmap 的 `--rerun eval:<prefix>` selector 砍掉

- **裁决**:收窄重跑 = 位置参数 + `--rerun all`,选择轴不进 selector。
- **否决理由**:CLI 只有两类输入(位置参数选 eval、flag 选怎么跑),
  `--rerun eval:` 让选择轴出现第二个家。`--accept` 的作用域同理由位置参数收窄。

## 裁决 4(实现语义):judge/sandbox 组内差异整组回滚才携带

- **裁决**:反事实校验按「指纹相等才是证明」——组里每条差异都被 accept 才携带,
  只 accept 一半照常重跑。
- **理由**:部分回滚会让未被授权的共存差异搭便车溜过指纹门;保守方向的代价只是多跑。

配套契约:配置面差异从 run.json 算出、不依赖 manifest;缺 manifest 只降级源码/数据面为
`opaque:no-manifest`(存量 `.niceeval/` 树上 config 差异仍给具名原因)。
