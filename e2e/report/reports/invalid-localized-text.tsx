/** @jsxImportSource niceeval/report */

import type { LocalizedText } from "niceeval/report";
import { Col, Hero, defineReport } from "niceeval/report";

const incompleteLocaleMap = {
  en: "Incomplete locale map must not render",
} as unknown as LocalizedText;

export default defineReport({
  title: "Invalid LocalizedText fixture",
  pages: [{
    id: "invalid-localized-text",
    title: "Invalid LocalizedText",
    render() {
      return (
        <Col>
          <Hero title={incompleteLocaleMap} />
        </Col>
      );
    },
  }],
});
