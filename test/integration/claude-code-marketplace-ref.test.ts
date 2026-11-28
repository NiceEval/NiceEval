import fc from "fast-check";
import { claudeCodeAgent } from "niceeval/adapter";
import { expect, test } from "vitest";

const repo = fc.stringMatching(/^[a-z][a-z0-9-]{0,12}$/);
const ref = fc.oneof(fc.stringMatching(/^[0-9a-f]{7,40}$/), fc.constantFrom("main", "v1.3.0"));
const source = fc.oneof(
  repo.map((name) => ({ official: true, source: `anthropics/${name}` })),
  repo.map((name) => ({ official: true, source: `https://github.com/anthropics/${name}.git` })),
  fc
    .tuple(repo.filter((owner) => owner !== "anthropics"), repo)
    .map(([owner, name]) => ({ official: false, source: `${owner}/${name}` })),
);

// @feature docs/feature/adapters/library/sdk/claude-code/README.md
// Reduced regression from the issue: the official marketplace with a commit ref used to pass
// construction and fail during setup when Claude Code refused the local clone.
test("claudeCodeAgent rejects a ref on an Anthropic marketplace when the factory is built", () => {
  fc.assert(
    fc.property(source, fc.option(ref, { nil: undefined }), ({ official, source }, pinned) => {
      const build = () =>
        claudeCodeAgent({
          plugins: [
            {
              marketplace: { name: "claude-plugins-official", source, ...(pinned === undefined ? {} : { ref: pinned }) },
              name: "frontend-design",
            },
          ],
        });
      if (official && pinned !== undefined) {
        expect(build).toThrow(TypeError);
        expect(build).toThrow(/cannot use ref/u);
      } else {
        expect(build).not.toThrow();
      }
    }),
    {
      examples: [
        [{ official: true, source: "anthropics/claude-plugins-official" }, "3160b166dcefc641f84e48ea2d136b8890f1de65"],
      ],
    },
  );
});
