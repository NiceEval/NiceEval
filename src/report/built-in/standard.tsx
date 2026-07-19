// standard —— 内建视图之一:报告 / Attempts / 追踪三页的通用结果站 + 一张隐藏的 attempt
// 详情页,没有任何私有钩子(docs/feature/reports/library/built-in.md)。裸 `niceeval show` 与
// `niceeval view` 装载的就是它:一份普通 defineReport,与用户的 --report 文件同层、走同一条
// 装载 → resolve → validate → render 管线。「builtin」不是装载逻辑里的类别,
// 只是宿主默认拿哪个值的事实;用户报告经 defineReport({ extends: standard, … }) 整站复用。
//
// 四页:report(Hero + 警告 + 批量修复 prompt + 实验对比)、attempts(带过滤的 attempt
// 全列表)、traces(执行瀑布)三页进导航;第四张 standardAttemptPage 以 locator 为输入、
// 不进导航,locator 深链打开它,content 就是公开的 AttemptDetail 组合组件。裸宿主导航上能
// 看到的一切内容都在这份定义里;宿主保留的只有机器(docs/feature/reports/architecture.md
// 「宿主保留的只有机器」)。

import {
  AttemptDetail,
  AttemptList,
  Col,
  CopyFixPrompt,
  ExperimentComparison,
  Hero,
  ScopeWarnings,
  TraceWaterfall,
  defineReport,
} from "../index.ts";

export const standardAttemptPage = {
  id: "attempt",
  title: "Attempt",
  input: "attempt",
  navigation: false,
  content: <AttemptDetail />,
} as const;

export const standard = defineReport({
  pages: [
    {
      id: "report",
      title: { en: "Report", "zh-CN": "报告" },
      content: (
        <Col>
          <Hero />
          <ScopeWarnings />
          <CopyFixPrompt />
          <ExperimentComparison />
        </Col>
      ),
    },
    {
      id: "attempts",
      title: "Attempts",
      content: (
        <Col>
          <Hero />
          <ScopeWarnings />
          <AttemptList filter />
        </Col>
      ),
    },
    {
      id: "traces",
      title: { en: "Traces", "zh-CN": "追踪" },
      content: (
        <Col>
          <Hero />
          <ScopeWarnings />
          <TraceWaterfall />
        </Col>
      ),
    },
    standardAttemptPage,
  ],
});
