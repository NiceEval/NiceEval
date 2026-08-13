export interface ShowJsonDocument {
  format: string;
  schemaVersion: number;
  view: string;
  sample: {
    resultsRoot: string;
    experiments: string[];
    fresh: boolean;
    evalPrefix?: string;
  };
  data: unknown;
}

export function asShowJson(value: unknown): ShowJsonDocument {
  if (typeof value !== "object" || value === null) {
    throw new Error(`show --json is not an object: ${JSON.stringify(value)}`);
  }
  const doc = value as ShowJsonDocument;
  if (doc.format !== "niceeval.show") {
    throw new Error(`expected format "niceeval.show", got ${JSON.stringify(doc.format)}`);
  }
  if (doc.schemaVersion !== 1) {
    throw new Error(`expected schemaVersion 1, got ${JSON.stringify(doc.schemaVersion)}`);
  }
  if (typeof doc.view !== "string") {
    throw new Error(`show --json missing view: ${JSON.stringify(doc)}`);
  }
  return doc;
}

export function assertPublicShowJson(value: unknown): ShowJsonDocument {
  const serialized = JSON.stringify(value);
  if (serialized.includes("niceeval.report-show")) {
    throw new Error("0.12 show JSON must not emit niceeval.report-show");
  }
  if (serialized.includes('"children"') && /"format":"niceeval\.report-show/.test(serialized)) {
    throw new Error("0.12 show JSON must not emit report children JSON");
  }
  return asShowJson(value);
}
