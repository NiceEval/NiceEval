import { describe, expect, it } from "vitest";
import { enumerateReportTargets, planSite } from "./plan-site";
import { reportRecordFixture } from "../../test/fixtures/report-record";

describe("reports.target-census", () => {
  it("最终 page、链接和导出文档使用同一组 target identity", () => {
    const record = reportRecordFixture.withAttemptExperimentAndCustomPage();
    const declared = enumerateReportTargets(record);
    const plan = planSite(record);

    expect(new Set(plan.pages.map((page) => `${page.pageId}:${page.key}`)))
      .toEqual(new Set(declared.map((target) => `${target.pageId}:${target.key}`)));
    expect(plan.orphanLinks).toEqual([]);
    expect(plan.orphanDocuments).toEqual([]);
  });
});
