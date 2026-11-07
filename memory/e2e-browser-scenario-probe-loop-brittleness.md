# 浏览器交互场景：探测循环与隐藏类断言的脆性

## 现象

`e2e/report/scripts/report-components/` 的三类浏览器场景在一次报告迁移中反复被改，
且没有一次改动对应契约变化：

- `ExperimentTable · 逐层展开到 Attempt 并打开详情`（metric-table）：用
  `for (depth < 4)` 循环「点开任何未展开 summary、直到出现 locator」的探测式路径。
  宿主报告被误删 `...standard.pages` 展开（Attempt 详情页整组丢失）时，该场景的症状是
  「层级有了但点不开」——失败落在离病因最远的断言上，回归最终靠人工浏览器排查定位，
  测试本身没能说清哪里坏了。选择器还在 `:visible` 伪类与 `filter({ visible: true })`
  之间往返改了两次。
- `MetricTable / AttemptList · 过滤收窄`：断言读实现隐藏用的
  `.niceeval-row-hidden` class（机制不是契约），且用 `waitForTimeout(100)`
  固定 sleep 等过滤生效，即时 `count()` 配 sleep 有竞态。
- `MetricMatrix · 浏览器呈现矩阵`：仅断言 `.niceeval-metric-matrix` 元素存在，
  class 出现证明不了用户看到了矩阵，属于把 class 本身写进预期。

## 根因

浏览器交互层没有设计过的断言词表：e2e-acceptance-dsl 提案原来把这层标为
「现有 Playwright 写法保留」，于是每个场景各自发明寻址、等待与断言写法，
探测循环、机制类断言、固定 sleep 三种反模式都是在缺词表的空档里长出来的。
探测式路径还把「宿主缺页 / 层级未渲染 / 链接不可点」折叠成同一种失败，
丧失定位力。

## 修法

写法规则现位于 `docs/roadmap/testing/dsl/README.md`「浏览器交互」五条：
步骤确定不探测、前置条件先行断言、断言可见效果不断言机制、等待只等状态、
选择器方言收敛进库。生态调研裁决「引擎全部现成，不自建」——寻址用
getByRole / 可见文本官方优先序、等待用 web-first assertion 自动重试、结构用
toMatchAriaSnapshot，库只补领域词与步骤轨迹（词表见同目录 library.md，
逐场景重写对照见 use-case/browser-interaction.md）。这三类场景是词表落地后
第一批重写对象；重写前不要以现行写法为模板新增浏览器场景。
