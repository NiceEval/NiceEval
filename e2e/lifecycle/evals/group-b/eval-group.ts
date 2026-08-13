import { defineEvalGroup } from "niceeval";
import first from "./01-first.eval.ts";
import second from "./02-second.eval.ts";

export default defineEvalGroup({
  evals: [first, second],
  onUnavailable: "stop-group",
});
