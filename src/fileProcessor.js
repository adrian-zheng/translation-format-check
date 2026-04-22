import { inflateRawSync } from "pako";
import { analyzeText } from "./formatChecker.js";

const HEADER_WEIGHTS = [
  [/^(target|translation|translated|english|en)$/i, 80],
  [/(target|translation|translated[_\s-]*text|english|英文|英语|英译|译文|翻译)/i, 70],
  [/(source|original|中文|原文|key|id|编号)/i, -60]
];

export function parseSpreadsheetFile(buffer, filename = "") {
  const name = filename.toLowerCase();
  if (name.endsWith(".csv")) {
    return parseCsv(decodeText(buffer));
  }

  if (name.endsWith(".xlsx")) {
    return parseXlsx(new Uint8Array(buffer));
  }

  throw new Error("Only .csv and .xlsx files are supported.");
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      if (row.some((value) => value !== "")) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some((value) => value !== "")) {
    rows.push(row);
  }

  return rows;
}

export function detectTranslationColumn(rows) {
  if (!rows.length) {
    return { index: -1, header: "", confidence: 0, scores: [] };
  }

  const headers = rows[0] ?? [];
  const columnCount = Math.max(...rows.map((row) => row.length));
  const dataRows = rows.slice(1).filter((row) => row.some((value) => String(value ?? "").trim()));
  const scores = [];

  for (let index = 0; index < columnCount; index += 1) {
    const header = String(headers[index] ?? "").trim();
    const values = dataRows.map((row) => String(row[index] ?? "").trim()).filter(Boolean);
    let score = scoreHeader(header);

    const sample = values.slice(0, 80);
    if (sample.length) {
      const englishLike = sample.filter(isEnglishLike).length / sample.length;
      const cjkHeavy = sample.filter(hasHeavyCjk).length / sample.length;
      const averageLength =
        sample.reduce((sum, value) => sum + value.length, 0) / Math.max(sample.length, 1);

      score += englishLike * 55;
      score -= cjkHeavy * 50;
      if (averageLength >= 8) {
        score += 10;
      }
      if (averageLength >= 140) {
        score -= 8;
      }
    } else {
      score -= 20;
    }

    scores.push({ index, header, score: Math.round(score) });
  }

  scores.sort((a, b) => b.score - a.score);
  const best = scores[0] ?? { index: -1, header: "", score: 0 };
  return {
    index: best.index,
    header: best.header,
    confidence: Math.max(0, Math.min(100, best.score)),
    scores
  };
}

export function checkBatchRows(rows) {
  const translationColumn = detectTranslationColumn(rows);
  if (translationColumn.index < 0) {
    throw new Error("Could not detect a translation column.");
  }

  const dataRows = rows.slice(1);
  const records = [];
  const correctedRows = [insertAfter(rows[0] ?? [], translationColumn.index, "修正后译文")];
  const totals = {
    dash: 0,
    quote: 0,
    ellipsis: 0,
    space: 0
  };

  for (let index = 0; index < dataRows.length; index += 1) {
    const row = dataRows[index];
    const originalText = String(row[translationColumn.index] ?? "");
    const analysis = analyzeText(originalText);
    const correctedRow = insertAfter(row, translationColumn.index, analysis.correctedText);
    correctedRows.push(correctedRow);

    for (const [rule, count] of Object.entries(analysis.issueCounts)) {
      totals[rule] += count;
    }

    records.push({
      rowNumber: index + 2,
      rowIndex: index,
      key: createRowKey(row, index),
      originalText,
      correctedText: analysis.correctedText,
      correctedSegments: analysis.correctedSegments,
      changes: analysis.changes,
      issueCounts: analysis.issueCounts,
      hasChanges: analysis.hasChanges
    });
  }

  const changedRows = records.filter((record) => record.hasChanges).length;

  return {
    headers: rows[0] ?? [],
    translationColumn,
    totalRows: dataRows.length,
    changedRows,
    cleanRows: dataRows.length - changedRows,
    totals,
    correctedRows,
    records
  };
}

function parseXlsx(buffer) {
  const files = unzip(buffer);
  const sharedStrings = parseSharedStrings(files.get("xl/sharedStrings.xml") ?? "");
  const sheetPath = findFirstSheetPath(files);
  const sheetXml = files.get(sheetPath);
  if (!sheetXml) {
    throw new Error("Could not find a worksheet in this .xlsx file.");
  }

  return parseWorksheet(sheetXml, sharedStrings);
}

function unzip(buffer) {
  const files = new Map();
  const endOffset = findEndOfCentralDirectory(buffer);
  const centralCount = uint16LE(buffer, endOffset + 10);
  let offset = uint32LE(buffer, endOffset + 16);

  for (let index = 0; index < centralCount; index += 1) {
    if (uint32LE(buffer, offset) !== 0x02014b50) {
      throw new Error("Invalid .xlsx central directory.");
    }

    const method = uint16LE(buffer, offset + 10);
    const compressedSize = uint32LE(buffer, offset + 20);
    const nameLength = uint16LE(buffer, offset + 28);
    const extraLength = uint16LE(buffer, offset + 30);
    const commentLength = uint16LE(buffer, offset + 32);
    const localOffset = uint32LE(buffer, offset + 42);
    const name = utf8Slice(buffer, offset + 46, offset + 46 + nameLength);

    const localNameLength = uint16LE(buffer, localOffset + 26);
    const localExtraLength = uint16LE(buffer, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.slice(dataStart, dataStart + compressedSize);
    const content = method === 0 ? compressed : inflateRawSync(compressed);
    files.set(name, utf8Decode(content));

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return files;
}

function findEndOfCentralDirectory(buffer) {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (uint32LE(buffer, offset) === 0x06054b50) {
      return offset;
    }
  }
  throw new Error("Invalid .xlsx file.");
}

function findFirstSheetPath(files) {
  const workbook = files.get("xl/workbook.xml") ?? "";
  const rels = files.get("xl/_rels/workbook.xml.rels") ?? "";
  const sheetMatch = workbook.match(/<sheet\b[^>]*r:id="([^"]+)"/);
  const relationshipId = sheetMatch?.[1];

  if (relationshipId) {
    const relPattern = new RegExp(`<Relationship\\b[^>]*Id="${escapeRegExp(relationshipId)}"[^>]*>`, "i");
    const relationship = rels.match(relPattern)?.[0] ?? "";
    const target = relationship.match(/Target="([^"]+)"/i)?.[1];
    if (target) {
      return normalizeSheetTarget(target);
    }
  }

  return files.has("xl/worksheets/sheet1.xml")
    ? "xl/worksheets/sheet1.xml"
    : [...files.keys()].find((name) => name.startsWith("xl/worksheets/")) ?? "";
}

function normalizeSheetTarget(target) {
  if (target.startsWith("/")) {
    return target.slice(1);
  }
  if (target.startsWith("xl/")) {
    return target;
  }
  return `xl/${target}`;
}

function parseSharedStrings(xml) {
  const strings = [];
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const parts = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) =>
      decodeXml(part[1])
    );
    strings.push(parts.join(""));
  }
  return strings;
}

function parseWorksheet(xml, sharedStrings) {
  const rows = [];

  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g)) {
      const attrs = cellMatch[1] ?? cellMatch[3] ?? "";
      const body = cellMatch[2] ?? "";
      const cellRef = attrs.match(/\br="([^"]+)"/)?.[1] ?? "";
      const columnIndex = cellRef ? columnNameToIndex(cellRef.replace(/\d+/g, "")) : row.length;
      row[columnIndex] = parseCellValue(attrs, body, sharedStrings);
    }
    rows.push(row.map((value) => value ?? ""));
  }

  return rows.filter((row) => row.some((value) => value !== ""));
}

function parseCellValue(attrs, body, sharedStrings) {
  const type = attrs.match(/\bt="([^"]+)"/)?.[1] ?? "";
  if (type === "inlineStr") {
    return decodeXml([...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => match[1]).join(""));
  }

  const value = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? "";
  if (type === "s") {
    return sharedStrings[Number(value)] ?? "";
  }
  return decodeXml(value);
}

function columnNameToIndex(name) {
  let index = 0;
  for (const char of name.toUpperCase()) {
    index = index * 26 + char.charCodeAt(0) - 64;
  }
  return Math.max(index - 1, 0);
}

function decodeText(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return utf16LEToString(bytes.subarray(2));
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return utf8Decode(bytes.subarray(3));
  }
  return utf8Decode(bytes);
}

function utf16LEToString(buffer) {
  const chars = new Array(buffer.length / 2);
  for (let i = 0; i < chars.length; i++) {
    chars[i] = String.fromCharCode(uint16LE(buffer, i * 2));
  }
  return chars.join("");
}

function utf8Decode(buffer) {
  return new TextDecoder("utf-8").decode(buffer);
}

function uint16LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8);
}

function uint32LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16) | (buffer[offset + 3] << 24);
}

function utf8Slice(buffer, start, end) {
  return utf8Decode(buffer.slice(start, end));
}

function decodeXml(value) {
  return String(value)
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function scoreHeader(header) {
  return HEADER_WEIGHTS.reduce((score, [pattern, weight]) => {
    return pattern.test(header) ? score + weight : score;
  }, 0);
}

function isEnglishLike(value) {
  const letters = value.match(/[A-Za-z]/g)?.length ?? 0;
  const cjk = value.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  return letters >= 3 && letters > cjk * 2;
}

function hasHeavyCjk(value) {
  const cjk = value.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  return cjk > 0 && cjk / Math.max(value.length, 1) > 0.25;
}

function createRowKey(row, index) {
  const firstValue = String(row.find((value) => String(value ?? "").trim()) ?? "").trim();
  return firstValue || `Row ${index + 2}`;
}

function insertAfter(row, index, value) {
  const copy = row.slice();
  copy.splice(index + 1, 0, value);
  return copy;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
