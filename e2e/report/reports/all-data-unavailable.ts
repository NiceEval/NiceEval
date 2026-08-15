import { Either } from "effect";
import {
  attemptSlotProjection,
  definePage,
  defineReport,
  reportComponentId,
  reportDocument,
  reportId,
  reportInputs,
  reportRoute,
  scoreProjector,
} from "niceeval/report";

const unavailableInputs = reportInputs({
  score: attemptSlotProjection(scoreProjector),
});

const page = definePage({
  id: Either.getOrThrow(reportComponentId("all-data-unavailable-page")),
  route: Either.getOrThrow(reportRoute("/")),
  inputs: unavailableInputs,
  completeness: "require-complete",
  render: () => reportDocument({
    title: "This page must stay unavailable",
    children: [],
  }),
});

export default defineReport({
  id: Either.getOrThrow(reportId("all-data-unavailable")),
  pages: [page],
});
