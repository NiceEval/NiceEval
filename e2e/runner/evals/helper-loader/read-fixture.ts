import { loadText } from "niceeval/loaders";

// Read while this helper module evaluates: every Eval that imports the helper depends on it.
export const sharedNote = await loadText(new URL("./fixtures/shared.txt", import.meta.url));

/** Called from an Eval's top level: only the calling Eval depends on the file it reads. */
export async function readFixture(url: URL): Promise<string> {
  await Promise.resolve();
  return loadText(url);
}
