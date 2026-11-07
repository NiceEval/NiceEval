# attempt-source-unlocated-conversation-unstyled-and-escape-leak

## 现象

view 的 attempt 详情里,`AttemptSource` 源码块后的「Other conversation」兜底区(无 `loc` 轮次的唯一出现处)整轮退化成无排版文字墙:user prompt / assistant 文本 / 系统注入行连成流水没有条目边界;工具结果按裸 JSON 直出,`{"output":"a\nb\nc"}` 里的 `\n` 是两字符字面文本,多行路径全部粘连。「Other assertions」区正常。

## 根因

两条互相独立:

1. **CSS 第三容器零覆盖**:`.nre-conv-*` 全套回复条目样式按容器限定,只写了 `.nre-source-line-detail`(行内展开)与 `.nre-attempt-conversation`(独立分轮视图)两个容器;`TurnDetail` 复用同一 renderer 渲到第三个容器 `.nre-attempt-source-unlocated` 时一条选择器都不命中,退回浏览器默认排版。与 [[attempt-detail-components-shipped-without-styles]] 同类:「组件到了、CSS 没跟」,单元层 DOM 断言恒拦不住。
2. **自由文本收口发生在 stringify 之后**:`AttemptConversation.tsx` 的 `compact()` 对结构化值先 `JSON.stringify` 再 `/\s+/` 折空白——stringify 已把真实换行变成 `\n` 字面转义、控制字节变成 `\u001b` 文本,事后的折空白与 `stripControl` 都收不到;事后用正则拆 `\\[nrt]` 又会误伤内容里真实的「反斜杠+n」(如 `C:\notes`)。

## 修法

CSS 给第三容器补齐整套 `.nre-conv-*`(贴 AttemptSource 自身密度,扁平不套二级卡片);`compact()` 改为**先收口后字符串化**——递归 walk `JsonValue`,对每个字符串字段 `stripControl` + 折空白,再 `JSON.stringify`(`src/report/components/attempt-detail/AttemptConversation.tsx` + `src/report/assets/styles.css`;记得 `pnpm run build:report`)。契约同步补进 `docs/feature/reports/library/attempt-detail.md`「兜底区」,E2E 报告域加了「每个新渲染容器验收一次样式覆盖」条目。

通用教训:共享 renderer 每进一个新容器,按容器限定的 CSS 不会自动跟过去;自由文本的收口必须在序列化之前做,序列化后转义文本对正则和字节级清洗都不可见。
