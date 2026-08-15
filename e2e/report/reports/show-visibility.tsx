/** @jsxImportSource niceeval/report */

import type { Sample } from "niceeval/record";
import {
  Col,
  CopyBlock,
  SampleNotices,
  Section,
  defineReport,
  reportStatus,
  type ReportBlock,
} from "niceeval/report";
import {
  SHOW_COPY_BLOCK_TEXT,
  SHOW_HIERARCHY_CHAIN,
  SHOW_HIERARCHY_RENDERED,
} from "./show-visibility-copy.ts";

function deepHierarchyTable(): ReportBlock {
  const rows: Extract<ReportBlock, { readonly type: "cell-table" }>["rows"][number][] = [{
    key: "root",
    kind: "experiment",
    label: "deep-hierarchy-root",
    cells: { Name: "deep-hierarchy-root", Value: "0" },
  }];
  for (let index = 1; index <= SHOW_HIERARCHY_CHAIN; index += 1) {
    const leaf = index === SHOW_HIERARCHY_CHAIN;
    const name = leaf ? SHOW_HIERARCHY_RENDERED : `group-${index}`;
    rows.push({
      key: `g${index}`,
      kind: "group",
      label: name,
      parentKey: index === 1 ? "root" : `g${index - 1}`,
      cells: { Name: name, Value: String(index) },
    });
  }
  return {
    type: "cell-table",
    columns: ["Name", "Value"],
    hierarchy: true,
    rows,
  };
}

export default defineReport({
  title: "Show visibility fixture",
  pages: [
    {
      id: "visibility",
      title: "Visibility",
      render(sample: Sample) {
        return (
          <Col>
            <Section title="Selection notice">
              <SampleNotices input={sample} />
            </Section>
            <CopyBlock content={SHOW_COPY_BLOCK_TEXT} />
          </Col>
        );
      },
    },
    {
      id: "deep-hierarchy",
      title: "Deep hierarchy",
      render() {
        return (
          <Col>
            {deepHierarchyTable()}
            {reportStatus({
              tone: "neutral",
              label: SHOW_HIERARCHY_RENDERED,
            })}
          </Col>
        );
      },
    },
  ],
});
