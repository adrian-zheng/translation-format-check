import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import {
  checkBatchRows,
  detectTranslationColumn,
  parseCsv,
  parseSpreadsheetFile
} from "../src/fileProcessor.js";

test("parses quoted CSV rows", () => {
  const rows = parseCsv('id,source,target\n1,"你好, 世界","“Hello”—world…  now"\n');

  assert.deepEqual(rows, [
    ["id", "source", "target"],
    ["1", "你好, 世界", "“Hello”—world…  now"]
  ]);
});

test("detects likely translation column from headers and English content", () => {
  const rows = [
    ["key", "中文原文", "英文译文"],
    ["a1", "你好", "“Hello”—world…"],
    ["a2", "确认订单", "Confirm  the order."]
  ];

  const detection = detectTranslationColumn(rows);

  assert.equal(detection.index, 2);
  assert.equal(detection.header, "英文译文");
});

test("checks batch rows and reports only rows with changes", () => {
  const rows = [
    ["id", "source", "target"],
    ["1", "你好", "“Hello”—world…"],
    ["2", "谢谢", "Thank you."]
  ];
  const result = checkBatchRows(rows);

  assert.equal(result.totalRows, 2);
  assert.equal(result.changedRows, 1);
  assert.equal(result.records[0].rowNumber, 2);
  assert.equal(result.records[0].correctedText, '"Hello" – world...');
  assert.deepEqual(result.correctedRows, [
    ["id", "source", "target", "修正后译文"],
    ["1", "你好", "“Hello”—world…", '"Hello" – world...'],
    ["2", "谢谢", "Thank you.", "Thank you."]
  ]);
});

test("parses a minimal xlsx file", () => {
  const xlsx = createMinimalXlsx({
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?>
      <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
        xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
      </workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/>
      </Relationships>`,
    "xl/sharedStrings.xml": `<?xml version="1.0" encoding="UTF-8"?>
      <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <si><t>id</t></si><si><t>英文译文</t></si><si><t>1</t></si><si><t>“Hello”—world…</t></si>
      </sst>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <sheetData>
          <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
          <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>
        </sheetData>
      </worksheet>`
  });

  const rows = parseSpreadsheetFile(xlsx, "sample.xlsx");

  assert.deepEqual(rows, [
    ["id", "英文译文"],
    ["1", "“Hello”—world…"]
  ]);
});

function createMinimalXlsx(files) {
  const fileEntries = [];
  const centralEntries = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.from(content);
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    fileEntries.push(local, nameBuffer, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centralEntries.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + compressed.length;
  }

  const centralSize = centralEntries.reduce((sum, entry) => sum + entry.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...fileEntries, ...centralEntries, end]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
