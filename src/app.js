import { parseSpreadsheetFile, checkBatchRows } from "./fileProcessor.js";
import { buildCsv, buildXlsx } from "./exporter.js";

const ruleNames = {
  dash: "破折号 / en dash",
  quote: "全角引号",
  ellipsis: "省略号",
  space: "多余空格"
};

const elements = {
  fileInput: document.querySelector("#fileInput"),
  uploadButton: document.querySelector("#uploadButton"),
  exportFormat: document.querySelector("#exportFormat"),
  exportButton: document.querySelector("#exportButton"),
  batchStatus: document.querySelector("#batchStatus"),
  batchTotal: document.querySelector("#batchTotal"),
  batchChanged: document.querySelector("#batchChanged"),
  batchColumn: document.querySelector("#batchColumn"),
  batchIssues: document.querySelector("#batchIssues"),
  batchResults: document.querySelector("#batchResults"),
  filterAll: document.querySelector("#filterAll"),
  filterChanged: document.querySelector("#filterChanged"),
  tooltipLayer: document.querySelector("#tooltipLayer")
};

let currentBatchResult = null;
let currentBatchFilter = "all";
let selectedFilename = "translation_format_corrected";

function renderBatchResult(result) {
  currentBatchResult = result;
  currentBatchFilter = "all";
  const totalIssues = Object.values(result.totals).reduce((sum, count) => sum + count, 0);
  elements.batchTotal.textContent = result.totalRows;
  elements.batchChanged.textContent = result.changedRows;
  elements.batchColumn.textContent =
    result.translationColumn.header || `Column ${result.translationColumn.index + 1}`;
  elements.batchIssues.textContent = totalIssues;
  elements.batchStatus.textContent = `识别到译文列：${elements.batchColumn.textContent}。已检查 ${result.totalRows} 条记录。`;
  elements.exportButton.disabled = false;
  renderBatchRecords();
}

function renderBatchRecords() {
  if (!currentBatchResult) {
    return;
  }

  updateFilterButtons();
  elements.batchResults.replaceChildren();

  const records =
    currentBatchFilter === "changed"
      ? currentBatchResult.records.filter((record) => record.hasChanges)
      : currentBatchResult.records;

  if (!records.length) {
    const empty = document.createElement("div");
    empty.className = "batch-empty";
    empty.textContent =
      currentBatchFilter === "changed"
        ? "没有经过修改的记录。"
        : "文件里没有可检查的记录。";
    elements.batchResults.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const record of records) {
    fragment.append(createBatchRecord(record));
  }
  elements.batchResults.append(fragment);
}

function updateFilterButtons() {
  const isAll = currentBatchFilter === "all";
  elements.filterAll.classList.toggle("active", isAll);
  elements.filterChanged.classList.toggle("active", !isAll);
  elements.filterAll.setAttribute("aria-pressed", String(isAll));
  elements.filterChanged.setAttribute("aria-pressed", String(!isAll));
}

function createBatchRecord(record) {
  const item = document.createElement("article");
  item.className = record.hasChanges ? "batch-record has-changes" : "batch-record clean";

  const meta = document.createElement("div");
  meta.className = "batch-record-meta";
  const row = document.createElement("strong");
  row.textContent = `Row ${record.rowNumber}`;
  const key = document.createElement("span");
  key.textContent = record.key;
  meta.append(row, key);

  const original = document.createElement("div");
  original.className = "batch-text original";
  original.textContent = record.originalText || " ";

  const corrected = document.createElement("div");
  corrected.className = "batch-text corrected";
  renderInlineSegments(corrected, record.correctedSegments);

  const changeList = document.createElement("ol");
  changeList.className = "batch-change-list";
  renderRecordChangeList(changeList, record.changes);

  item.append(meta, original, corrected, changeList);
  return item;
}

function renderRecordChangeList(container, changes) {
  container.replaceChildren();

  if (!changes.length) {
    const empty = document.createElement("li");
    empty.className = "batch-change-empty";
    empty.textContent = "无修改";
    container.append(empty);
    return;
  }

  for (const change of changes) {
    const item = document.createElement("li");
    item.className = `batch-change-pill change-${change.rule}`;
    item.textContent = `${ruleNames[change.rule]}: ${visibleValue(change.before)} to ${visibleValue(change.after)}`;
    container.append(item);
  }
}

function renderInlineSegments(container, segments) {
  container.replaceChildren();
  for (const segment of segments) {
    const span = document.createElement("span");
    span.textContent = segment.text;
    if (segment.change) {
      span.className = `result-mark result-${segment.change.rule}`;
      span.tabIndex = 0;
      span.dataset.tooltip = createTooltipText(segment.change);
      span.setAttribute("aria-label", createTooltipText(segment.change));
    }
    container.append(span);
  }
}

function visibleValue(value) {
  return String(value ?? "")
    .replaceAll(" ", "␠")
    .replaceAll("\t", "⇥")
    .replaceAll("\u00a0", "NBSP");
}

function createTooltipText(change) {
  return `${ruleNames[change.rule]}: ${visibleValue(change.before)} to ${visibleValue(change.after)}`;
}

async function checkUploadedFile() {
  const file = elements.fileInput.files?.[0];
  if (!file) {
    elements.batchStatus.textContent = "请先选择 CSV 或 XLSX 文件。";
    return;
  }

  selectedFilename = file.name.replace(/\.[^.]+$/, "") || "translation_format_corrected";
  elements.batchStatus.textContent = `正在检查 ${file.name}...`;
  elements.uploadButton.disabled = true;
  elements.exportButton.disabled = true;

  try {
    const buffer = await file.arrayBuffer();
    const rows = parseSpreadsheetFile(buffer, file.name);
    const result = checkBatchRows(rows);
    renderBatchResult(result);
  } catch (error) {
    elements.batchStatus.textContent =
      error instanceof Error ? error.message : "文件处理失败。";
  } finally {
    elements.uploadButton.disabled = false;
  }
}

async function exportCorrectedFile() {
  if (!currentBatchResult?.correctedRows?.length) {
    elements.batchStatus.textContent = "请先完成批量检查，再导出文件。";
    return;
  }

  const format = elements.exportFormat.value === "csv" ? "csv" : "xlsx";
  elements.exportButton.disabled = true;
  elements.batchStatus.textContent = `正在导出 ${format.toUpperCase()}...`;

  try {
    const rows = currentBatchResult.correctedRows;
    const blob = format === "csv"
      ? new Blob([buildCsv(rows)], { type: "text/csv;charset=utf-8" })
      : new Blob([buildXlsx(rows)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    downloadBlob(blob, `${selectedFilename}_corrected.${format}`);
    elements.batchStatus.textContent = `已导出 ${format.toUpperCase()} 文件。`;
  } catch (error) {
    elements.batchStatus.textContent = error instanceof Error ? error.message : "导出失败。";
  } finally {
    elements.exportButton.disabled = false;
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function showTooltip(target) {
  const text = target.dataset.tooltip;
  if (!text) {
    return;
  }

  elements.tooltipLayer.textContent = text;
  elements.tooltipLayer.hidden = false;
  const rect = target.getBoundingClientRect();
  const tooltipRect = elements.tooltipLayer.getBoundingClientRect();
  const left = Math.min(
    Math.max(rect.left, 12),
    window.innerWidth - tooltipRect.width - 12
  );
  const topBelow = rect.bottom + 8;
  const top =
    topBelow + tooltipRect.height < window.innerHeight - 12
      ? topBelow
      : Math.max(rect.top - tooltipRect.height - 8, 12);

  elements.tooltipLayer.style.left = `${left}px`;
  elements.tooltipLayer.style.top = `${top}px`;
}

function hideTooltip() {
  elements.tooltipLayer.hidden = true;
}

elements.uploadButton.addEventListener("click", checkUploadedFile);
elements.exportButton.addEventListener("click", exportCorrectedFile);
elements.filterAll.addEventListener("click", () => {
  currentBatchFilter = "all";
  renderBatchRecords();
});
elements.filterChanged.addEventListener("click", () => {
  currentBatchFilter = "changed";
  renderBatchRecords();
});
elements.fileInput.addEventListener("change", () => {
  const file = elements.fileInput.files?.[0];
  elements.batchStatus.textContent = file ? `已选择：${file.name}` : "尚未上传文件。";
});
elements.batchResults.addEventListener("pointerover", (event) => {
  const target = event.target.closest(".result-mark");
  if (target) {
    showTooltip(target);
  }
});
elements.batchResults.addEventListener("pointerout", (event) => {
  if (event.target.closest(".result-mark")) {
    hideTooltip();
  }
});
elements.batchResults.addEventListener("focusin", (event) => {
  const target = event.target.closest(".result-mark");
  if (target) {
    showTooltip(target);
  }
});
elements.batchResults.addEventListener("focusout", hideTooltip);
window.addEventListener("scroll", hideTooltip, true);
window.addEventListener("resize", hideTooltip);
