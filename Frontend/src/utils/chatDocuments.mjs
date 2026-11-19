// Generated content is treated strictly as text: no HTML execution, macros, formulas or remote assets.
function cells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((s) => s.trim().replace(/\\\|/g, "|"));
}
const separator = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
export function parseContent(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("|") && i+1 < lines.length && separator(lines[i+1])) {
      const rows = [cells(lines[i])]; i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) { rows.push(cells(lines[i])); i++; }
      i--;
      const width = Math.max(...rows.map((r) => r.length));
      blocks.push({ type: "table", rows: rows.map((r) => Array.from({ length: width }, (_, j) => r[j] ?? "")) });
    } else if (!/^\s*```/.test(lines[i])) {
      const heading = /^(#{1,3})\s+(.*)$/.exec(lines[i]);
      blocks.push({ type: heading ? "heading" : "paragraph", level: heading?.[1].length, text: heading ? heading[2] : lines[i] });
    }
  }
  return blocks;
}
function plain(text) { return String(text).replace(/\*\*(.*?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1"); }
function assertContent(text) {
  if (typeof text !== "string" || !text.trim()) throw new Error("La réponse est vide.");
  if (text.length > 200000) throw new Error("Réponse trop longue. Demandez un document plus court.");
}
export async function createWord(text) {
  assertContent(text);
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, VerticalAlign } = await import("docx");
  const runs = (value) => String(value).split(/(\*\*.*?\*\*)/g).map((part) => new TextRun({ text: plain(part), bold: part.startsWith("**") && part.endsWith("**") }));
  const children = parseContent(text).map((b) => b.type === "table"
    ? new Table({ margins: { top: 90, bottom: 90, left: 100, right: 100 }, borders: Object.fromEntries(["top", "bottom", "left", "right", "insideHorizontal", "insideVertical"].map((side) => [side, { style: BorderStyle.SINGLE, size: 4, color: "D9D9D9" }])), width: { size: 100, type: WidthType.PERCENTAGE }, rows: b.rows.map((row, i) => new TableRow({ tableHeader: i === 0, children: row.map((value) => new TableCell({ verticalAlign: VerticalAlign.CENTER, shading: i === 0 ? { fill: "E8ECF7" } : undefined, children: [new Paragraph({ children: runs(value) })] })) })) })
    : new Paragraph({ children: runs(b.text), heading: b.type === "heading" ? [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][b.level-1] : undefined, spacing: { after: 120 } }));
  const document = new Document({ creator: "Kyntus CQ", title: "Document Assistant QA", styles: { default: { document: { run: { font: "Calibri", size: 22, color: "000000" } }, heading1: { run: { color: "000000", bold: true } }, heading2: { run: { color: "000000", bold: true } }, heading3: { run: { color: "000000", bold: true } } } }, sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children }] });
  return Packer.toBlob(document);
}
function excelValue(raw, header = "") {
  const text = plain(raw);
  // Never evaluate formulas. Preserve identifiers with leading zeroes and long numbers.
  if (/identif|matric|code|\beps\b|\bid\b|téléphone|telephone|numéro|numero/i.test(header)) return text;
  const normalized = text.replace(/[\u00a0\u202f ]/g, "").replace(",", ".");
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?%$/.test(normalized)) return { t: "n", v: Number(normalized.slice(0,-1))/100, z: "0.0%" };
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized) && normalized.replace(/\D/g, "").length <= 15) return Number(normalized);
  return text;
}
export async function createExcel(text) {
  assertContent(text);
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  // Always preserve the complete response, including explanatory text around tables.
  const complete = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (!line.length) complete.push([""]);
    for (let i = 0; i < line.length; i += 32000) complete.push([line.slice(i, i+32000)]);
  }
  const response = XLSX.utils.aoa_to_sheet([["Réponse de l’assistant QA"], ...complete]);
  response["!cols"] = [{ wch: 110 }];
  XLSX.utils.book_append_sheet(workbook, response, "Réponse");
  let index = 0;
  for (const block of parseContent(text)) {
    if (block.type !== "table") continue;
    if (block.rows.some((row) => row.some((c) => c.length > 32767))) throw new Error("Une cellule dépasse la limite Excel. Demandez un tableau plus compact.");
    const sheet = XLSX.utils.aoa_to_sheet(block.rows.map((row, i) => row.map((c, col) => i === 0 ? plain(c) : excelValue(c, block.rows[0][col]))));
    sheet["!cols"] = block.rows[0].map((_, col) => ({ wch: Math.min(60, Math.max(14, ...block.rows.map((row) => plain(row[col]).length + 2))) }));
    sheet["!autofilter"] = { ref: sheet["!ref"] };
    XLSX.utils.book_append_sheet(workbook, sheet, `Tableau ${++index}`);
  }
  return new Blob([XLSX.write(workbook, { type: "array", bookType: "xlsx" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
export async function downloadChatDocument(text, format) {
  const blob = format === "docx" ? await createWord(text) : await createExcel(text);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url;
  link.download = `Assistant_QA_${new Date().toISOString().slice(0,10)}.${format}`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
