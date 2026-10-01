**相关文档**:[README](README.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [DECISION](DECISION.md)

# Goals

### 目的与范围

本决策属于 Observability 写入契约与 Inspection 呈现契约之间的一层：应用事件以什么形式成为人读展示。
它不改变 Verdict、score、Assertion 或 usage，也不决定外部网页接入面、View 布局、主题或组件体系。

### 设计原则

- Agent 是 Adapter 的特例。展示按 source family 分支，不按 Adapter 名或“是否 Agent”分支。
- 通用化不能以压平已有专用语义为代价。
- Inspection 是选择、完整度与证据边界的唯一 owner；CLI 与 Web 只呈现闭合结果。
- 展示是观测事实的人读形式，不是评分材料。

## G1: 应用事件可读

任意 Adapter 能让自己的事件在 `show --execution` 与 View 中以文本、对话、键值或图片形式出现，而不只是 JSON。
完整轨迹保存在应用自己系统里时，读者能看到去哪里查询。验证：[C1](CASES.md)、[C2](CASES.md)、[C3](CASES.md)、[C9](CASES.md)。

## G2: Agent 体验不退化且按 source 中立

Agent 的 Conversation、Commands、配对、完整度与稳定 selector 呈现不因本决策改变或降级。
专用呈现按 source family 选择，任何 Adapter 写出同一 source 即得到同一呈现；核心与 renderer 不出现 Adapter 名分支。
Agent 与非 Agent 事件可以出现在同一 outline。验证：C5、C8。

## G3: 历史确定可读

同一份 Record 或 Snapshot，在没有项目源码、没有加载 Adapter 的机器上，由同一 NiceEval 版本读出相同展示。验证：C4。

## G4: CLI 与 Web 同源

`query`、`show` 与 View 消费同一 Inspection result；展示不能在某个 consumer 中独自重算或补造。验证：C1、C4。

## G5: 读取侧安全

读取 Record 不执行作者代码。展示内容不能向终端注入控制序列，也不能向浏览器注入 HTML 或脚本。验证：C7。

## G6: 有界

展示遵守 Attempt 级写入预算与 Inspection 分页预算；超限时明确失败或明确截断，不静默丢弃。验证：C7。

## G7: 无展示的事件照常可读

没有展示的事件和既有 Record 继续以 summary 与 JSON 呈现，不报错、不补造展示。验证：C6。

### 不以本决策达到

- 作者自定义布局、主题、组件、Page 或任意 renderer。
- Markdown、HTML 或富文本排版。
- 用展示内容参与 Assertion、Judge 或评分。
- 外部 benchmark 网页的数据或组件 ABI。
