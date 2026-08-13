/** @jsxImportSource niceeval/report */

import { Col, Hero, defineReport } from "niceeval/report";

export default defineReport({
  title: "Invalid classic link fixture",
  pages: [{
    id: "report",
    title: "Report",
    render: () => (
      <Col>
        <Hero
          description="The classic semantic boundary must reject non-HTTPS navigation."
          links={[{ label: "Rejected link", href: "http://example.com/report" }]}
        />
      </Col>
    ),
  }],
});
