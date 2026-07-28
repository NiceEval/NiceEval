# 渲染面改类名,enhance.js 的钩子静默失效:图表 tooltip 已经坏了一段时间

## 现象

`enhance.js` 里三处钩子指向的类名/属性**全仓没有任何组件产出**:

| 钩子 | 状态 |
| --- | --- |
| `[data-niceeval-experiment-sort]` / `[data-niceeval-experiment-filter]` + `.niceeval-experiment-entry` | 组件早已换成 `Table` 原语,整段永不触发 |
| `input[data-niceeval-attempt-filter]` + `.niceeval-attempt` | 同上,过滤由 `Table` 的 `data-niceeval-filter` 接管 |
| `.niceeval-scatter-point` / `.niceeval-line-point` | **真 bug**:图表点现在是 `.niceeval-chart-dot`,样式化 tooltip 从此不出现 |

前两条只是死代码,第三条是能力丢失:`.niceeval-tooltip` 的 CSS 还在、`<title>` 还在,所以页面
看着"有 tooltip",实际弹的是浏览器原生黄框——**降级形态和增强形态长得都对,只是一直停在降级态**。
死代码那段里还留着批量改名的误伤:`querySelectorAll(":sample > .niceeval-experiment-entry")`,
`:sample` 不是合法选择器,真被触发会抛 SyntaxError。没人发现,正说明它从没被执行过。

## 根因

`enhance.js` 按类名/`data-*` 属性反向依赖渲染面,而这层依赖**没有任何编译期或运行期检查**:
组件改类名不会红,选择器选不中也不报错——`querySelectorAll` 命不中返回空集合,监听器悄悄早退。
类型系统够不着(一边是 JSX 字符串,一边是 vanilla JS 字符串),单元测试也够不着(要真实
hover + 真实 CSS 才看得出 tooltip 有没有渲染)。

## 修法

死掉的两段整体删除,tooltip 的选择器重接到 `.niceeval-chart-dot`
(`src/report/assets/enhance.js`,同批删掉 `styles.css` 里同样孤儿的 `.niceeval-experiment-*` 列宽规则)。
验证只能靠真实浏览器:Chromium 里 hover 一个点,断言 `.niceeval-tooltip` 出现且 `<title>` 被搬走。

**这类回归的验收归 e2e 报告域**(与 [[css-classname-grep-guard-retired]] 同一条边界:
src-grep 文本对齐证明不了样式生效)。当前 e2e 缺一条"hover 图表点 → 出现 `.niceeval-tooltip`"
的断言,也缺一条"enhance.js 的每个选择器都还能选中东西"的整页体检——后者比逐条断言更值,
因为它对下一次改名同样有效。

顺带记一条未修的缺口:`Chart` 的 `tooltip?: boolean` prop 声明在契约里,渲染侧一次都没读
(`<title>` 无条件输出),所以 `tooltip` 开不开都一样。

## 适用场景

任何"渲染侧出类名、增强脚本按类名找"的接缝。改组件类名时,把 `enhance.js` 与 `styles.css`
当作同一次改动的调用点一起普查——这是 CLAUDE.md「给共享接口加可选字段:数着调用点过」
在 DOM 契约上的同型问题。
