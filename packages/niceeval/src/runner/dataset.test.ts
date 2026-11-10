import { describe, it, expect } from "vitest";
import { defineDataset, defineScoreDataset } from "../define.ts";
import { isDatasetDefinition } from "../runner/types.ts";

describe("defineDataset & defineScoreDataset", () => {
  it("creates a branded dataset definition with synchronous array", () => {
    const ds = defineDataset({
      description: "sync dataset",
      tags: ["test", "rag"],
      data: [{ id: "q1", query: "hi" }, { id: "q2", query: "hello" }],
      key: (row) => row.id,
      test: (t, row) => {
        expect(row.query).toBeDefined();
      },
    });

    expect(isDatasetDefinition(ds)).toBe(true);
    expect(ds.description).toBe("sync dataset");
    expect(ds.evaluationKind).toBe("pass");
    expect(Array.isArray(ds.data)).toBe(true);
  });

  it("creates a branded score dataset definition with async data loader", async () => {
    const ds = defineScoreDataset({
      description: "score dataset",
      data: async () => [{ prompt: "test" }],
      test: (t, row) => {
        expect(row.prompt).toBe("test");
      },
    });

    expect(isDatasetDefinition(ds)).toBe(true);
    expect(ds.evaluationKind).toBe("score");
    expect(typeof ds.data).toBe("function");
    if (typeof ds.data === "function") {
      const rows = await ds.data();
      expect(rows).toEqual([{ prompt: "test" }]);
    }
  });

  it("rejects invalid test or data parameters", () => {
    expect(() => {
      // @ts-expect-error invalid test
      defineDataset({ data: [] });
    }).toThrow(TypeError);

    expect(() => {
      // @ts-expect-error invalid data
      defineDataset({ test: () => {} });
    }).toThrow(TypeError);
  });
});
