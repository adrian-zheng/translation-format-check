import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("result tooltip uses a viewport-level floating layer", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.doesNotMatch(css, /\.result-mark::after/);
  assert.match(css, /\.floating-tooltip\s*\{/);
  assert.match(css, /position:\s*fixed/);
});
