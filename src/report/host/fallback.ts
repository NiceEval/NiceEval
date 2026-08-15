import { Either } from "effect";
import { reportRoute, type ReportRoute } from "../author/identity.ts";
import type { ReportExecution } from "../execution/model.ts";
import type { ReportProblem } from "../execution/problems.ts";
import {
  reportDocument,
  reportSection,
  reportStatus,
  reportText,
  type ReportDocument,
} from "../semantic/document.ts";

const fallbackRoute = Either.getOrThrow(reportRoute("/"));

export interface ReportFallbackPage {
  readonly route: ReportRoute;
  readonly document: ReportDocument;
}

interface FallbackCopy {
  readonly title: string;
  readonly unavailable: string;
  readonly unavailableDetail: string;
  readonly problems: string;
  readonly noProblems: string;
  readonly recordedDataProblem: string;
  readonly executionProblem: string;
  readonly consumer: (consumerId: string) => string;
  readonly input: (inputKey: string) => string;
  readonly slot: (slotId: string) => string;
  readonly run: (runId: string) => string;
  readonly summary: (summary: string) => string;
}

const FALLBACK_COPY_EN: FallbackCopy = Object.freeze({
  title: "Report data unavailable",
  unavailable: "No report page is available",
  unavailableDetail: "The selected recorded data cannot produce an author report page.",
  problems: "Report problems",
  noProblems: "No problem details were recorded.",
  recordedDataProblem: "Recorded-data problem",
  executionProblem: "Report execution problem",
  consumer: (consumerId: string) => `Consumer: ${consumerId}`,
  input: (inputKey: string) => `Input: ${inputKey}`,
  slot: (slotId: string) => `Slot: ${slotId}`,
  run: (runId: string) => `Run: ${runId}`,
  summary: (summary: string) => `Summary: ${summary}`,
});

const FALLBACK_COPY_ZH: FallbackCopy = Object.freeze({
  title: "报告数据不可用",
  unavailable: "没有可用的报告页面",
  unavailableDetail: "所选的已记录数据无法生成作者报告页面。",
  problems: "报告问题",
  noProblems: "没有已记录的问题详情。",
  recordedDataProblem: "已记录数据问题",
  executionProblem: "报告执行问题",
  consumer: (consumerId: string) => `使用方：${consumerId}`,
  input: (inputKey: string) => `输入：${inputKey}`,
  slot: (slotId: string) => `槽位：${slotId}`,
  run: (runId: string) => `运行：${runId}`,
  summary: (summary: string) => `摘要：${summary}`,
});

/**
 * Package-owned fallback for a closed execution with no root author page.
 * Both static and live hosts render this exact semantic document, so a
 * recorded-data problem never creates a second text-only page truth.
 */
export function reportFallbackPage(execution: ReportExecution): ReportFallbackPage {
  const copy = execution.locale === "zh-CN" ? FALLBACK_COPY_ZH : FALLBACK_COPY_EN;
  const problems = execution.problemTable.map(({ problem }) => reportStatus({
    tone: problem.category === "execution" ? "negative" : "warning",
    label: fallbackProblemLabel(problem, copy),
    detail: [reportText(fallbackProblemDetail(problem, copy))],
  }));
  return Object.freeze({
    route: fallbackRoute,
    document: reportDocument({
      title: copy.title,
      presentation: "classic-dashboard",
      children: [
        reportStatus({
          tone: "warning",
          label: copy.unavailable,
          detail: [reportText(copy.unavailableDetail)],
        }),
        reportSection({
          heading: copy.problems,
          children: problems.length === 0
            ? [reportStatus({ tone: "neutral", label: copy.noProblems })]
            : problems,
        }),
      ],
    }),
  });
}

function fallbackProblemLabel(problem: ReportProblem, copy: FallbackCopy): string {
  return `${problem.category === "execution" ? copy.executionProblem : copy.recordedDataProblem}: ${problem.code}`;
}

function fallbackProblemDetail(problem: ReportProblem, copy: FallbackCopy): string {
  if (problem.category === "execution") {
    return [copy.consumer(problem.consumerId), copy.summary(problem.summary)].join(" · ");
  }
  return [
    copy.consumer(problem.consumerId),
    ...(problem.inputKey === undefined ? [] : [copy.input(problem.inputKey)]),
    ...(problem.slotId === undefined ? [] : [copy.slot(problem.slotId)]),
    ...(problem.runId === undefined ? [] : [copy.run(problem.runId)]),
  ].join(" · ");
}
