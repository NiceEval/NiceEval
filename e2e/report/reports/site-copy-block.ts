import { reportStatus, reportText, type ReportBlock } from "niceeval/report";

export const FIXTURE_COPY_TEXT = "niceeval report fixture copy text";

const title = "Fixture copy block";

/** A normal semantic block in the Report's static import closure. */
export function siteCopyBlock(): ReportBlock {
  return reportStatus({
    tone: "neutral",
    label: title,
    detail: [reportText(FIXTURE_COPY_TEXT)],
  });
}
