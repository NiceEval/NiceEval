/** @jsxImportSource niceeval/report */

import type { AttemptEvidence } from "niceeval/record";
import {
  Col,
  Hero,
  Section,
  defineComponent,
  defineReport,
  reportParagraph,
  reportText,
} from "niceeval/report";

const AttemptFacts = defineComponent<{ readonly attempt: AttemptEvidence }>((props) =>
  reportParagraph([reportText(JSON.stringify({
    evaluationKind: props.attempt.evaluationKind,
    historical: props.attempt.historical,
    assertions: props.attempt.result.assertions,
    score: props.attempt.result.score,
  }))])
);
AttemptFacts.displayName = "AttemptFacts";

export default defineReport({
  title: "Classic Attempt fixture",
  pages: [{
    id: "attempt-evidence",
    title: "Attempt evidence",
    input: "attempt",
    navigation: false,
    render(attempt: AttemptEvidence) {
      return (
        <Col>
          <Hero title="Classic Attempt evidence" />
          <Section title="Projected facts">
            <AttemptFacts attempt={attempt} />
          </Section>
        </Col>
      );
    },
  }],
});
