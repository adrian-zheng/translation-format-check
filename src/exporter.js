import { deflateRawSync } from "pako";

export function buildCsv(rows) {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n") + "\r\n";
}

export function buildXlsx(rows) {
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
        <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      </Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
      </Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?>
      <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
        xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sheets><sheet name="Corrected" sheetId="1" r:id="rId1"/></sheets>
      </workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
      </Relationships>`,
    "xl/worksheets/sheet1.xml": buildWorksheetXml(rows)
  };

  return zipFiles(files);
}

function buildWorksheetXml(rows) {
  const rowXml = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, colIndex) => {
          const ref = `${columnName(colIndex)}${rowIndex + 1}`;
          return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>${rowXml}</sheetData>
    </worksheet>`;
}

function zipFiles(files) {
  const fileEntries = [];
  const centralEntries = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBuffer = new TextEncoder().encode(name);
    const data = new TextEncoder().encode(content);
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const local = new Uint8Array(30);
    writeUInt32LE(local, 0x04034b50, 0);
    writeUInt16LE(local, 20, 4);
    writeUInt16LE(local, 0, 6);
    writeUInt16LE(local, 8, 8);
    writeUInt32LE(local, crc, 14);
    writeUInt32LE(local, compressed.length, 18);
    writeUInt32LE(local, data.length, 22);
    writeUInt16LE(local, nameBuffer.length, 26);
    fileEntries.push(local, nameBuffer, compressed);

    const central = new Uint8Array(46);
    writeUInt32LE(central, 0x02014b50, 0);
    writeUInt16LE(central, 20, 4);
    writeUInt16LE(central, 20, 6);
    writeUInt16LE(central, 0, 8);
    writeUInt16LE(central, 8, 10);
    writeUInt32LE(central, crc, 16);
    writeUInt32LE(central, compressed.length, 20);
    writeUInt32LE(central, data.length, 24);
    writeUInt16LE(central, nameBuffer.length, 28);
    writeUInt32LE(central, offset, 42);
    centralEntries.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + compressed.length;
  }

  const centralSize = centralEntries.reduce((sum, entry) => sum + entry.length, 0);
  const end = new Uint8Array(22);
  writeUInt32LE(end, 0x06054b50, 0);
  writeUInt16LE(end, Object.keys(files).length, 8);
  writeUInt16LE(end, Object.keys(files).length, 10);
  writeUInt32LE(end, centralSize, 12);
  writeUInt32LE(end, offset, 16);

  return concatBuffers(fileEntries, centralEntries, end);
}

function writeUInt16LE(buffer, value, offset) {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >> 8) & 0xff;
}

function writeUInt32LE(buffer, value, offset) {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >> 8) & 0xff;
  buffer[offset + 2] = (value >> 16) & 0xff;
  buffer[offset + 3] = (value >> 24) & 0xff;
}

function concatBuffers(...arrays) {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function escapeCsvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnName(index) {
  let number = index + 1;
  let name = "";
  while (number > 0) {
    const remainder = (number - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    number = Math.floor((number - 1) / 26);
  }
  return name;
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
