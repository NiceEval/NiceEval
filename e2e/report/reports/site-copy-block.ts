import { Callout, Text } from "niceeval/report";

export const FIXTURE_COPY_TEXT = "niceeval report fixture copy text";

const title = "Fixture copy block";

/** A normal closed component subtree in the Report's static import closure. */
export function siteCopyBlock() {
  return Callout({
    tone: "neutral",
    title,
    children: [Text({ value: FIXTURE_COPY_TEXT })],
  });
}
