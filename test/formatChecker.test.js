import test from "node:test";
import assert from "node:assert/strict";
import { analyzeText, createDiffSegments, demoSamples } from "../src/formatChecker.js";

test("normalizes em dash and en dash spacing", () => {
  const result = analyzeText("The launch—planned for May–is ready.");

  assert.equal(result.correctedText, "The launch – planned for May – is ready.");
  assert.deepEqual(
    result.changes.map((change) => change.rule),
    ["dash", "dash"]
  );
});

test("converts full-width quotes to half-width quotes", () => {
  const result = analyzeText("She called it “finished” and said ‘ship it’.");

  assert.equal(result.correctedText, "She called it \"finished\" and said 'ship it'.");
  assert.equal(result.changes.filter((change) => change.rule === "quote").length, 4);
});

test("converts Chinese ellipsis characters to three English periods", () => {
  const result = analyzeText("The review paused… then continued…… finally.");

  assert.equal(result.correctedText, "The review paused... then continued... finally.");
  assert.equal(result.changes.filter((change) => change.rule === "ellipsis").length, 2);
});

test("removes extra horizontal spaces without collapsing new paragraphs", () => {
  const result = analyzeText("This  line has   gaps.\n\nNext\t\tline.");

  assert.equal(result.correctedText, "This line has gaps.\n\nNext line.");
  assert.equal(result.changes.filter((change) => change.rule === "space").length, 3);
});

test("removes leading and trailing horizontal spaces on each line", () => {
  const result = analyzeText("  Leading space. \nTrailing space.  ");

  assert.equal(result.correctedText, "Leading space.\nTrailing space.");
  assert.equal(result.changes.filter((change) => change.rule === "space").length, 3);
});

test("produces a complete correction and summary for mixed issues", () => {
  const result = analyzeText("“Alpha”—a draft…  needs  review.");

  assert.equal(result.correctedText, "\"Alpha\" – a draft... needs review.");
  assert.equal(result.issueCounts.dash, 1);
  assert.equal(result.issueCounts.quote, 2);
  assert.equal(result.issueCounts.ellipsis, 1);
  assert.equal(result.issueCounts.space, 2);
  assert.equal(result.hasChanges, true);
});

test("returns corrected text segments with hoverable change metadata", () => {
  const result = analyzeText("“Alpha”—ready…  now");
  const renderedText = result.correctedSegments.map((segment) => segment.text).join("");
  const changedSegments = result.correctedSegments.filter((segment) => segment.change);

  assert.equal(renderedText, result.correctedText);
  assert.equal(changedSegments[0].text, "\"");
  assert.equal(changedSegments[0].change.rule, "quote");
  assert.equal(changedSegments[0].change.before, "“");
  assert.equal(changedSegments[0].change.after, "\"");
  assert.ok(changedSegments.some((segment) => segment.change.rule === "dash"));
  assert.ok(changedSegments.some((segment) => segment.change.rule === "ellipsis"));
});

test("includes fake demo samples for local testing", () => {
  assert.ok(demoSamples.length >= 3);
  assert.ok(demoSamples.every((sample) => sample.title && sample.text));
});

test("builds display segments for changed text", () => {
  const segments = createDiffSegments("A—B  C", "A – B C");

  assert.equal(
    segments.filter((segment) => segment.type === "same").map((segment) => segment.text).join(""),
    "AB C"
  );
  assert.equal(
    segments.filter((segment) => segment.type === "removed").map((segment) => segment.text).join(""),
    "— "
  );
  assert.equal(
    segments.filter((segment) => segment.type === "added").map((segment) => segment.text).join(""),
    " – "
  );
});
