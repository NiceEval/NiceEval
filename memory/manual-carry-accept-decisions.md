# 手动复用标记定稿的裁决

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

## 裁决 5:selector 按路径命中,不按值转换收窄(2026-07-30 评审补裁)

- **裁决**:同一路径多个不同旧值,一条 selector 全部授权;转换精度只进 `carriedAccepting`
  留痕,`--dry` 分组按「selector × 旧值→新值」各成一组、accept 命令行同一条。
- **曾选方案**:selector 携带值转换(如 `config:judge.model=a→b`)。
- **否决理由**:授权词表失去可打字、可复述性;精确账在留痕层已有,授权层再背一遍只多一种
  语法。要收窄批次走位置参数,与作用域规则同一条路。

## 裁决 6:TTY 交互标记保留,定性为「拼 selector 的助手」(2026-07-30 评审补裁)

- **裁决**:不带值的 `--accept` 是对交互标记的显式请求,TTY 检测只回答请求能否被满足;
  执行的永远是打印出的等价带值命令,带值形态是唯一规范形态。「重跑」= 不授权,与跳过同效。
- **曾选方案**:删掉交互模式——评审指它与「TTY 只决定人读版式」原则相抵,且与
  `--dry` 可复制命令、直接带 selector 三入口重叠。
- **否决理由**:形态由「不带值」这个写法选定,不是 TTY 分叉出的第二形态,原则不破;
  多条差异一次选完并产出等价命令,是复制 `--dry` 输出覆盖不了的增量。

评审同批修正:裁决 4 的整组语义与反事实指纹判据从 memory/测试文档升格进
`cache.md` `--accept` 节正文;`--rerun failed` 组合语义补进同节;
`docs/engineering/testing/unit/record.md` 超时触发层声明与两员 `trigger` 枚举对齐。
