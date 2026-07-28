// view --report / show --report 测试用的真实报告文件:defineReport 树形态默认导出,
// 内置组件 + 自定义摆法 + <Style> 产物 + Section.meta/Grid/Stat 排版原语,与
// docs-site/zh/tutorials/custom-reports.mdx 的示例同构。show 与 view 的宿主测试都吃这一份,
// 两扇门同一棵树。组件全部写 spec 形态,数据来源默认宿主注入的 Scope,由管线在 resolve
// 阶段代调配套 *Data——作者不写取数管道。Grid/Stat 只呈现作者手写的已格式化摘要,
// 不读 Scope、不聚合 Metric,证明它们能与数据组件在同一棵树里共存。

import {
  ExperimentList,
  defineComposition,
  defineReport,
} from "niceeval/report";

const ExamReport = defineComposition(() => <ExperimentList />);

export default defineReport(<ExamReport />);
