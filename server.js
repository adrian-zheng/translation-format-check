import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { createServer } from "node:http";
import { buildCsv, buildXlsx } from "./src/exporter.js";
import { checkBatchRows, parseSpreadsheetFile } from "./src/fileProcessor.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3001);
const root = process.cwd();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function resolvePath(url) {
  const pathname = new URL(url, `http://${host}:${port}`).pathname;
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(root, requestedPath));
  return filePath.startsWith(root) ? filePath : join(root, "index.html");
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function handleBatchCheck(request, response) {
  try {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    const filename = url.searchParams.get("filename") ?? "";
    const body = await readRequestBody(request);
    const rows = parseSpreadsheetFile(body, filename);
    const result = checkBatchRows(rows);
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error instanceof Error ? error.message : "Could not process this file."
    });
  }
}

async function handleExport(request, response) {
  try {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
    const body = JSON.parse((await readRequestBody(request)).toString("utf8"));
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) {
      throw new Error("No corrected rows to export.");
    }

    if (format === "xlsx") {
      const workbook = buildXlsx(rows);
      response.writeHead(200, {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": "attachment; filename=\"translation_format_corrected.xlsx\""
      });
      response.end(workbook);
      return;
    }

    response.writeHead(200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=\"translation_format_corrected.csv\""
    });
    response.end(buildCsv(rows));
  } catch (error) {
    sendJson(response, 400, {
      error: error instanceof Error ? error.message : "Could not export this file."
    });
  }
}

createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);

  if (request.method === "POST" && url.pathname === "/api/batch-check") {
    void handleBatchCheck(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/export") {
    void handleExport(request, response);
    return;
  }

  const filePath = resolvePath(request.url ?? "/");

  if (!existsSync(filePath)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "content-type": mimeTypes[extname(filePath)] ?? "application/octet-stream"
  });
  createReadStream(filePath).pipe(response);
}).listen(port, host, () => {
  console.log(`Translation format checker running at http://${host}:${port}/`);
});
