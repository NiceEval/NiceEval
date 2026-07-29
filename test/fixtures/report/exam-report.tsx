// view --report / show --report 测试用的真实报告文件:defineReport + page.render,
// 内置组合件摆法与 docs-site 自定义报告教程同构。

import { Col, SampleOverview, defineReport } from "niceeval/report";

export default defineReport({
  pages: [
    {
      id: "report",
      title: "Exam",
      render: (sample) => (
        <Col>
          <SampleOverview input={sample} />
        </Col>
      ),
    },
  ],
});
