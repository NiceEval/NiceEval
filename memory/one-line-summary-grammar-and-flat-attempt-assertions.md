# 裁决：单行摘要语法单点定义；attempt 首页四段分节让位平铺混排

日期：2026-07-22

## 裁决一：单行压缩摘要的语法收拢为 display.md 的单点定义

**现象**：比较列表 / `--history` 时间轴的单行失败摘要在 docs 里漂移出 5 种写法——`equals(4) · expected 4 · received 3`（display 契约例）、`expected: 4 · received: 3`（attempt.md 带冒号）、`expected 4, received 3`（default-report / history / entity-lists 逗号）、`expected ready, received pending`（无 matcher 标题）、`command exited 1 · commandSucceeded()`（顺序反转，且与同文件另一例自相矛盾）；docs-site 教程还即兴出 `calledTool("get_weather") · 未调用`、`gate: tool was never called` 这类契约外散文，丢掉 received 的诊断价值（分不清「一个工具都没调」和「调了别的」）。

**根因**：display.md 契约一只定义了 exp 面的两行排版，说比较列表「折单行再截断」，但单行拼接语法（分隔符、关键词、`gate:` 前缀去留、expected 省略规则）从未定义，下游示例各写各的。

**裁决**：`docs/feature/scoring/library/display.md#单行压缩形态` 新增单点定义——`<标题> · <检查方式> · expected <值> · received <值>`，全 ` · ` 分隔、关键词不带冒号、无 `gate:` 前缀；matcher 参数即条件的断言（equals/includes/calledTool/maxCost…）省 `expected`，`received` 连关键词永不省；soft 用 `score / threshold` 占值位、unavailable 用 reason 占值位。**曾选方案**：永远保留 expected（否决：与 matcher 参数重复，挤占窄单元格里 received 的宽度）；自由散文失败原因词（否决：契约外、无信息增量、机器不可解析）。

## 裁决二：show attempt 首页按结果四段分节被平铺混排取代

**现象**：display.md（2026-07-14 定稿）说 show attempt 首页按 `failures:` / `soft below threshold:` / `scores:` / `unavailable:` 四段分节；attempt.md（2026-07-19 Phase G reorg）说 AttemptSource「按原始声明顺序平铺全部非 passed 断言，✗ gate / ✗ soft / ◌ unavailable 混排，不分四段」。两篇描述同一表面，直接矛盾。

**裁决**：以更新的 Phase G 设计为准——平铺混排赢，display.md 通用渲染规则、契约二与全部按家族示例重写为平铺形态（`✗ gate · <标题>`、`◌` 三态、无阈值纯打分行不带图标）；docs-site 教程（viewing-results / agent-feedback-loop / debugging，中英）的 `failures:` 四段示例同步铲平。**否决理由**：分节是四段方案的残留，两套并存会让实现无所适从；声明顺序保住「断言与源码声明一一对应」的心智。

**修法落点**：display.md、reports/show/{attempt,history,default-report,eval-source}.md、reports/library/entity-lists.md、reports/use-case 两篇、docs-site 中英各 4 页教程/参考；`--history` 区域框加宽 7 列容纳 `received` 关键词。附带修掉 viewing-results / agent-feedback-loop 里失败示例引用了别的 eval 数据（weather/brooklyn 的 attempt 页贴着 swelancer 的 Issue 15193 断言）的不自洽。
