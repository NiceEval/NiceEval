# NiceEval 视觉设计总纲

NiceEval 所有可见面共用一套设计语言：**层级靠排版和留白，区分靠位置和明度，颜色只在有语义时出现**。这一页裁决整个产品的观感从哪来、由谁定义、被什么守护；每个面的具体规范在各自的文档里，这里只放路由和不允许分叉的总规则。

## 观感的单源：basalt

产品只有一份默认色板，住在 `src/report/theme.ts` 的官方暗色主题
[Basalt](docs/feature/reports/themes/basalt.md)：近黑面、`#262626` 发丝线、灰阶三级文字、
零圆角，语义色只有 positive / negative / warning 三个，分类用六色 CVD 色板。
任何一个可见面需要颜色时从这份主题取，不自立 hex。

| 可见面 | 怎么消费这份色板 | 规范文档 |
|---|---|---|
| 报告组件（`niceeval/report`） | 官方 stylesheet 每个用点读 `var(--niceeval-*, <basalt 兜底>)` | [Library · 主题](docs/feature/reports/library/theme.md) |
| `niceeval view` 宿主 chrome | `src/view/styles.css` 的 `:root` 短名读同一组令牌、同一份兜底 | [View](docs/feature/reports/view.md) |
| 内部文档与公开站的手绘 SVG | 共用样式段手抄 basalt 值，`pnpm test:docs` 逐张比对 | [SVG 图示的视觉契约](docs/SVG-DESIGN.md) |
| 产品站点（`site/`） | `app/globals.css` 的 `:root` 短名直接钉死 basalt 值 | [site/README.md](site/README.md) |

产品站点 `site/`（landing page）的叙事自由，观感不自由：色板、零圆角、无渐变无阴影
三条按本纲走。站点不装主题机制，令牌值抄 basalt，只有暗色一套。

## 主题机制：观感不写死在官方样式里

官方 stylesheet 只声明结构与令牌用点，不写死任何观感——颜色、字体、字号、圆角全部经
公开令牌（`--niceeval-color-*`、`--niceeval-font-*`、`--niceeval-radius`）进来。
兜底值抄 basalt 并由守护钉住逐项相等，所以「不装任何主题」与「装 basalt」看到同一个样子，
basalt 也因此不需要自带一行 CSS。

官方主题有两套，一暗一浅、一直角一圆角，互为「观感完整住在主题里」的证明：

| 主题 | 名字 | 一句话 |
|---|---|---|
| [Basalt](docs/feature/reports/themes/basalt.md) | `basalt` | 暗色（默认）：黑面、直角、发丝线、近无彩 accent |
| [Chalk](docs/feature/reports/themes/chalk.md) | `chalk` | 浅色：白面、8px 圆角、蓝 accent |

机制的全部契约——`defineTheme` 的字段、四档装载链、令牌全集、CSS 级联顺序——在
[Library · 主题](docs/feature/reports/library/theme.md)。

## 公开定制面

- **`.niceeval-report`** 是主题边界：官方组件在其中输出稳定的 `niceeval-*` 语义 class。
  `niceeval-*` 由 NiceEval 保留；自定义组件用自己的前缀，读同一组令牌。
- **`--niceeval-*`** 是令牌前缀：在包住报告的容器上声明同名令牌即可整体换观感，
  完整令牌表见 [theme.md「CSS 覆盖与完整重写」](docs/feature/reports/library/theme.md#css-覆盖与完整重写)。
- CSS 可以重写视觉结构，但不得改变数据、初始 HTML 中的数值和无 JavaScript 可读性，
  不得隐藏 NiceEval 品牌位，也不得用颜色作为判定或 series 的唯一信息载体。

## 设计主张（各面通用）

- 盒子默认不带颜色：面加 1px 边，仅此而已。区域用边表达，不用色块铺。
- 不用渐变、阴影、发光、彩色描边、装饰性色条；层次靠两级表面色与 1px 边框。
- 语义色含义固定：positive = 通过 / 达成，negative = 失败 / 错误，warning = 等待 / 注意 /
  不可用。不因为好看借用。
- 分类色只表示名义身份（实验、agent、标签），不表示好坏；六槽顺序不重排，
  散列分配规则见 [components/README.md](docs/feature/reports/components/README.md)。
- 强调靠提亮或字重 600，不放大字号、不加粗描边；数值一律 tabular numerals。
- 判定不依赖颜色单独表意：符号与文字始终同场。

## 守护

| 不变量 | 守护 |
|---|---|
| 官方 CSS（report 与 view）的令牌兜底 = basalt | `test/unit/report-theme-tokens.test.ts` |
| SVG 图示的样式段、用语与色值不漂移 | `pnpm test:docs`（`test/docs/`） |

stylesheet 类名与组件发射类名是否对齐不设 src 层守护：样式断没断只有真实产物能证明，
验收归 e2e 报告域对导出站的计算样式与几何断言（候选断言词表见
[testing/dsl](docs/roadmap/testing/dsl/README.md)）。

改色的唯一动线：改 `src/report/theme.ts` 的 basalt → 按守护红灯同步 CSS 兜底与
SVG 共用样式段。反向（先改 CSS 再回填主题）不成立，守护会拦。
