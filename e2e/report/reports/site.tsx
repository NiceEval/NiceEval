// The one custom report consumed by both public show and view --out.
// It deliberately uses only the public report authoring API.
import type { AttemptEvidence, Sample } from "niceeval/record";
import type { AttemptListItem, AttemptLocator, Cell, PageLoadContext, PageParams } from "niceeval/report";
import {
  AttemptAssessment,
  AttemptSummary,
  Col,
  SampleOverview,
  Table,
  ATTEMPT_PAGE_ID,
  defineReport,
  toAttemptListRows,
  toAttemptSummary,
} from "niceeval/report";

function attemptRows(items: readonly AttemptListItem[]): Array<{
  key: string;
  entity: Cell;
  verdict: Cell;
  result: Cell;
}> {
  return items.map((item) => ({
    key: item.locator,
    entity: { kind: "locator", locator: item.locator },
    verdict: { kind: "verdict", verdict: item.verdict },
    result:
      item.failureSummary === null
        ? { kind: "text", text: "—" }
        : {
            kind: "summary",
            text: item.failureSummary,
            ...(item.moreFailures > 0 ? { more: item.moreFailures } : {}),
          },
  }));
}

async function overviewRender(_sample: Sample) {
  return (
    <Col>
      <SampleOverview />
    </Col>
  );
}

async function attemptsRender(sample: Sample) {
  const items = await toAttemptListRows(sample);
  return (
    <Col>
      <Table
        rows={attemptRows(items)}
        columns={["entity", "verdict", "result"]}
        searchable
      />
    </Col>
  );
}

async function reviewRender(attempt: AttemptEvidence) {
  return (
    <Col>
      <AttemptSummary data={await toAttemptSummary(attempt)} />
      <AttemptAssessment attempt={attempt} />
    </Col>
  );
}

type AttemptPageParams = { locator: AttemptLocator };

const attemptPageParams: PageParams<AttemptPageParams> = {
  encode: ({ locator }) => locator,
  decode: (key) => ({ locator: key as AttemptLocator }),
  enumerate: (sample) => sample.attempts.flatMap((attempt) => {
    const locator = attempt.locator;
    return locator === undefined ? [] : [{ locator }];
  }),
};

function loadAttemptPage(
  _sample: Sample,
  params: AttemptPageParams,
  ctx: PageLoadContext,
): Promise<AttemptEvidence> {
  return ctx.evidence(params.locator);
}

export default defineReport({
  title: { en: "Report fixture", "zh-CN": "Report fixture" },
  pages: [
    {
      id: "overview",
      title: { en: "Overview", "zh-CN": "Overview" },
      render: overviewRender,
    },
    {
      id: "attempts",
      title: { en: "Attempts", "zh-CN": "Attempts" },
      render: attemptsRender,
    },
    {
      id: ATTEMPT_PAGE_ID,
      title: { en: "Review", "zh-CN": "Review" },
      params: attemptPageParams,
      navigation: false,
      load: loadAttemptPage,
      render: reviewRender,
    },
  ],
});
