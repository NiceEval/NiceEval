// cases: docs/engineering/testing/unit/reports.md
// 报告作者静态契约：page union 与 factory 私有品牌。

import { describe, expect, it } from "vitest";

import type { Sample } from "../../record/types.ts";
import {
  defineReport,
  type PageDefinition,
  type PageParams,
  type ParameterizedPageDefinition,
  type PageLoad,
  type ReportDefinition,
} from "./report.ts";
import { defineTheme, type ThemeDefinition } from "../theme.ts";

interface Detail {
  readonly id: string;
}

const detailParams: PageParams<{ id: string }> = {
  encode: ({ id }) => id,
  decode: (id) => ({ id }),
  enumerate: () => [],
};

const detailLoad: PageLoad<{ id: string }, Detail> = (_base, params) => ({ id: params.id });

const detailPage: ParameterizedPageDefinition<{ id: string }, Detail> = {
  id: "detail",
  title: "Detail",
  params: detailParams,
  navigation: false,
  load: detailLoad,
  render: (detail) => {
    const id: string = detail.id;
    void id;
    return null;
  },
};

const overviewPage: PageDefinition = {
  id: "overview",
  title: "Overview",
  render: (sample) => {
    const scope: Sample = sample;
    void scope;
    return null;
  },
};

// @ts-expect-error 参数化页缺少 load，不能靠装载期才发现
const missingParameterizedLoad: PageDefinition<{ id: string }, Detail> = {
  id: "missing-load",
  title: "Missing load",
  params: detailParams,
  navigation: false,
  render: () => null,
};
void missingParameterizedLoad;

// @ts-expect-error 显式 Params 的页不能退回普通页；否则宿主会把 Sample 交给 Detail render。
const parameterizedPageCannotBePlain: PageDefinition<{ id: string }, Detail> = {
  id: "plain-detail",
  title: "Plain detail",
  render: (detail) => {
    const id: string = detail.id;
    void id;
    return null;
  },
};
void parameterizedPageCannotBePlain;

const navigableParameterizedPage: PageDefinition<{ id: string }, Detail> = {
  id: "navigable-detail",
  title: "Navigable detail",
  params: detailParams,
  // @ts-expect-error 参数化页不能出现在导航里
  navigation: true,
  load: detailLoad,
  render: () => null,
};
void navigableParameterizedPage;

// @ts-expect-error ReportDefinition 只能由 defineReport() 归一化并加私有品牌
const fabricatedReport: ReportDefinition = {
  kind: "report",
  head: [],
  pages: [] as never,
};
void fabricatedReport;

// @ts-expect-error ThemeDefinition 只能由 defineTheme() 归一化并加私有品牌
const fabricatedTheme: ThemeDefinition = { kind: "theme" };
void fabricatedTheme;

if (false) {
  defineReport({
    pages: [
      // @ts-expect-error defineReport() 的 pages 元组同样拒绝缺 load 的参数化页
      {
        id: "missing-inline-load",
        title: "Missing inline load",
        params: detailParams,
        navigation: false,
        render: () => null,
      },
    ],
  });
}

describe("报告作者静态契约", () => {
  it("保留合法普通页与参数化页的 Params / Input 推断", () => {
    const definition = defineReport({ pages: [overviewPage, detailPage] });
    const theme = defineTheme({ accent: "#123456" });
    expect(definition.pages).toHaveLength(2);
    expect(theme.kind).toBe("theme");
  });
});
