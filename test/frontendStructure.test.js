import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("frontend removes standalone diff view and exposes batch filters", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");

  assert.doesNotMatch(html, /diffView|差异视图/);
  assert.doesNotMatch(app, /createDiffSegments|renderDiff/);
  assert.match(html, /id="filterAll"/);
  assert.match(html, /id="filterChanged"/);
});

test("batch records have original, corrected, and change-list columns", () => {
  const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.match(app, /batch-change-list/);
  assert.match(css, /grid-template-columns:\s*110px minmax\(0, 1fr\) minmax\(0, 1fr\) minmax\(220px, 0\.8fr\)/);
});

test("frontend is batch-only and has export controls", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

  assert.doesNotMatch(html, /sampleSelect|sourceText|correctedText|changeList|toolbar|workspace|review-grid/);
  assert.match(html, /id="exportFormat"/);
  assert.match(html, /id="exportButton"/);
});

test("tooltip is a floating layer instead of clipped pseudo content", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.match(html, /id="tooltipLayer"/);
  assert.match(app, /showTooltip/);
  assert.doesNotMatch(css, /\.result-mark::after/);
  assert.match(css, /\.floating-tooltip/);
});
