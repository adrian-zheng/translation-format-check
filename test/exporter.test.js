import test from "node:test";
import assert from "node:assert/strict";
import { buildCsv, buildXlsx } from "../src/exporter.js";
import { parseCsv, parseSpreadsheetFile } from "../src/fileProcessor.js";

test("builds a downloadable csv with quoted cells", () => {
  const csv = buildCsv([
    ["id", "target"],
    ["1", '"Hello" – world...'],
    ["2", "Text with, comma"]
  ]);

  assert.deepEqual(parseCsv(csv), [
    ["id", "target"],
    ["1", '"Hello" – world...'],
    ["2", "Text with, comma"]
  ]);
});

test("builds a downloadable xlsx that can be parsed back", () => {
  const rows = [
    ["id", "target"],
    ["1", '"Hello" – world...']
  ];
  const xlsx = buildXlsx(rows);

  assert.deepEqual(parseSpreadsheetFile(xlsx, "export.xlsx"), rows);
});
