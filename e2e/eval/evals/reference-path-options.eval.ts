import { defineEval } from "niceeval";
import { equals, not, referencesAnyPath } from "niceeval/expect";

export default defineEval({
  test(t) {
    const sensitive = referencesAnyPath(["NiceEval/NiceEval"]);
    t.check(sensitive.name, equals(referencesAnyPath(["NiceEval/NiceEval"], { ignoreCase: false }).name));
    t.check("https://github.com/niceeval/niceeval/docs", not(sensitive));
    t.check(
      { nested: ["https://github.com/niceeval/niceeval/docs"] },
      referencesAnyPath(["NiceEval/NiceEval"], { ignoreCase: true }),
    );
    t.check("SECRETS/api.key", referencesAnyPath(["secrets"], { ignoreCase: true }));
    t.check("ſecrets/api.key", referencesAnyPath(["secrets"], { ignoreCase: true }));
    t.check("ς/file", referencesAnyPath(["σ"], { ignoreCase: true }));
    t.check("K/file", referencesAnyPath(["k"], { ignoreCase: true }));
    t.check("AGENTS-old/a.ts", not(referencesAnyPath(["agents"], { ignoreCase: true })));
    t.check("AGENTS\\.\\nested/a.ts", referencesAnyPath(["agents/nested"], { ignoreCase: true }));
  },
});
