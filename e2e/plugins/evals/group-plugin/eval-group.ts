import { defineEvalGroup } from "niceeval";
import first from "./01-first.eval.ts";
import second from "./02-second.eval.ts";
import { lifecycle } from "../../plugins/lifecycle.ts";

export default defineEvalGroup({
  evals: [second, first],
  onUnavailable: "stop-group",
  plugins: [
    lifecycle({ marker: process.env.PLUGIN_GROUP_VARIANT ?? "stable" }),
    lifecycle({ marker: "second" }),
  ],
});
