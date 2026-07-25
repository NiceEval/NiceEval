# 给报告换主题，或做一份自己的主题包

## 解决什么问题

同一批结果要出现在三个地方：本地 `view` 里自己看、发布成公司 benchmark 站、贴进产品页。三处的报告口径应该一样，长相却常常不一样——对内看重密度，对外看重品牌，产品页要跟着产品的设计系统走。

主题和报告是两份分开的制品，所以这件事不必复制报告文件：报告说给谁看什么，主题说长什么样，换一个不动另一个。

## 全流程

### 1. 先用 `--theme` 试装

不改任何文件，对着同一份报告换外观：

```bash
niceeval view --theme ./themes/acme.ts
niceeval view --report reports/site.tsx --theme ./themes/acme.ts
niceeval view --theme basalt                 # 内建主题名，回到官方外观
```

生效的主题只有一份，四档取值：`--theme` → 报告自带的 `theme` → 配置的 `theme` → 内建 [`basalt`](../themes/basalt.md)（[取值链](../library/theme.md#装载链)）。

### 2. 写主题文件

只改品牌色时，一个字段就是一份完整主题：

```tsx
// themes/acme.ts
import { defineTheme } from "niceeval/report";

export default defineTheme({ accent: { light: "#6D28D9", dark: "#C4B5FD" } });
```

单个颜色在两种外观下原样使用；品牌色只适合某个背景时给出两套，NiceEval 不替你猜另一支。要做一份认得出来的主题，动的是色板、中性面、字体与形状，再用 `styles` 收尾——字段全集见[主题](../library/theme.md#公开形状)。

```tsx
// themes/acme.ts
import { defineTheme } from "niceeval/report";

export default defineTheme({
  appearance: "system",
  accent: { light: "#6D28D9", dark: "#C4B5FD" },
  page: { light: "#FFFBF5", dark: "#120F0C" },
  surface: { light: "#FFFFFF", dark: "#1C1713" },
  font: { sans: '"IBM Plex Sans", ui-sans-serif, sans-serif' },
  radius: "2px",
  styles: [{ src: "./acme.css" }],
});
```

`./acme.css` 相对**主题文件**解析，不是报告文件——这是主题能整包搬走的前提。

### 3. 定型后设成默认

团队里没人应该每次都敲 `--theme`：

```ts
// niceeval.config.ts
import { defineConfig } from "niceeval";
import acme from "./themes/acme";
import site from "./reports/site";

export default defineConfig({
  report: site,
  theme: acme,
});
```

之后裸 `niceeval view` 就是自己的报告加自己的外观，`--theme` 退回成「本次换一份」的临时开关。要单独给某一份报告钉死外观（例如对外发布的那份必须是品牌色，不受项目配置影响），写进那份报告的外壳：

```tsx
// reports/public-site.tsx
export default defineReport({
  extends: standard,
  title: "Acme Evals",
  theme: acme,
});
```

### 4. 跨项目分发

主题是普通值，发包不需要新机制：一个 npm 包，默认导出 `defineTheme` 产物，CSS 与字体随包走。

```tsx
import acme from "@acme/niceeval-theme";

export default defineConfig({ theme: acme });
```

在别人的主题上改一项，用普通对象展开——令牌整字段覆盖，`styles` 是数组，拼接就是数组拼接：

```tsx
export default defineTheme({
  ...acme,
  accent: { light: "#0F766E", dark: "#5EEAD4" },
  styles: [...(acme.styles ?? []), { inline: ".nre .nre-hero { padding-block: 48px; }" }],
});
```

### 5. 发布与嵌入

静态导出带着同一份主题，本地看到什么发出去就是什么：

```bash
niceeval view --report reports/site.tsx --theme ./themes/acme.ts --out site
```

把报告零件嵌进自己的 React 页面时，同一份主题也能用：

```tsx
import { themeStylesheet } from "niceeval/report";
import acme from "@acme/niceeval-theme";

<style dangerouslySetInnerHTML={{ __html: themeStylesheet(acme) }} />;
```

或者反过来——不注入主题，直接在包住 `.nre` 的容器上声明自己产品的 `--nre-*` 令牌，报告零件就长成产品的样子。

## 边界

- **主题只作用于 web 面。** `niceeval show --theme …` 报错并指向 `view`；终端那一面没有颜色令牌这一层。
- **档只选一份，不跨档合并。** 生效主题里没声明的令牌取官方值，不从下一档借。要「继承一份再改两项」，在主题文件里用对象展开。
- **换主题不改数字。** 主题不进 `ctx`，不参与 resolve，不改变组件树或任何数值；页级色分配只产出色槽下标，换主题不重算。
- **哪个实验恒用哪个色槽是报告的事，不是主题的事。** 「baseline 恒中性、我们的方案恒蓝」写在报告外壳的 [`seriesPins`](../library/shell.md#钉色)，这样换配色不会让两者对调身份。
- **浅深切换由主题的 `appearance` 决定。** `system` 给读者一个切换控件，`light` / `dark` 锁死全站；无 JavaScript 时初始外观即声明的那一支。
- **自定义组件要先按纪律写才跟得上。** 写死 hex 的组件在陌生主题下会露馅，规范见[自己写报告组件](write-custom-component.md)。
- **主题不改品牌位。** 页头 NiceEval 字标与 `PoweredBy` 不从 `accent` 取色，主题不是隐藏宿主品牌的机制。

## 相关阅读

- [主题](../library/theme.md) —— 令牌全集、装载链、校验与 CSS 级联。
- [Basalt](../themes/basalt.md) —— 官方主题的取值与视觉主张。
- [自己写报告组件](write-custom-component.md) —— 让自己的组件跟随任何主题。
- [外壳与多页](../library/shell.md) —— `theme` / `seriesPins` / `styles` 在外壳里的位置。
- [`--out`:把结果导出成静态站发布](view-out-publish.md) —— 发布路径。
