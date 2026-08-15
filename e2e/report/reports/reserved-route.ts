import { Either } from "effect";
import {
  definePage,
  defineReport,
  reportComponentId,
  reportId,
  reportRoute,
} from "niceeval/report";

const callbackMarker = "RESERVED_ROUTE_AUTHOR_CALLBACK_RAN";

const page = definePage({
  id: Either.getOrThrow(reportComponentId("reserved-route")),
  route: Either.getOrThrow(reportRoute("/_niceeval/author-page")),
  render: () => {
    throw new Error(callbackMarker);
  },
});

export default defineReport({
  id: Either.getOrThrow(reportId("reserved-route-fixture")),
  pages: [page],
});
