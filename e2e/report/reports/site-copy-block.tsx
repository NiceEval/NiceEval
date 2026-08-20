import { Section, Text } from "niceeval/report";

export const FIXTURE_COPY_TEXT = "niceeval report fixture copy text";

/** A normal closed component subtree in the Report's static import closure. */
export function siteCopyBlock() {
  return (
    <Section title="Fixture copy block">
      <Text>{FIXTURE_COPY_TEXT}</Text>
    </Section>
  );
}
