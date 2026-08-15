/** The exact built-in facade fixed in docs/feature/reports/library.md. */
export {
  standard,
  standardAttemptPage,
  standardAttemptsPage,
  standardExperimentPage,
  standardOverviewPage,
  standardTracesPage,
} from "./standard.tsx";

export {
  attemptDetailRoute,
  attemptDetailTarget,
  experimentDetailRoute,
  experimentDetailTarget,
  libraryDetailRoute,
} from "../library/details.ts";

export type {
  AttemptDetailTarget,
  ExperimentDetailTarget,
  LibraryDetailTarget,
} from "../library/details.ts";
