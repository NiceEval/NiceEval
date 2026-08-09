import type { Sample } from "niceeval/record";
import { Col, Text } from "niceeval/report";

const marker = "INDIRECT_FIRST";

export function configReloadContent(sample: Sample) {
  return (
    <Col>
      <Text>{marker}</Text>
      <Text>{`ATTEMPTS_${sample.attempts.length}`}</Text>
    </Col>
  );
}
