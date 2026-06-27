import ExcelJS from "exceljs";

/**
 * Input extraction. The four onboarding paths (chat text, pasted raw text, CSV,
 * Excel) all converge here into one plain-text representation that Gemini then
 * normalises (brief §B). Text and CSV are already text; XLSX is decoded
 * server-side. The LLM does the messy reconciliation, not this step.
 */
export type InputKind = "text" | "csv" | "xlsx";

export interface RawInput {
  readonly kind: InputKind;
  /** Text/CSV: the content verbatim. XLSX: base64-encoded workbook bytes. */
  readonly content: string;
}

export async function extractText(input: RawInput): Promise<string> {
  if (input.kind !== "xlsx") return input.content;

  const wb = new ExcelJS.Workbook();
  // exceljs is typed against an older @types/node Buffer; the generic Buffer in
  // @types/node 22 is nominally incompatible. Cast to exceljs's own param type.
  const bytes = Buffer.from(input.content, "base64");
  await wb.xlsx.load(bytes as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const lines: string[] = [];
  wb.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      lines.push(values.map((v) => (v == null ? "" : String(v))).join("\t"));
    });
  });
  return lines.join("\n");
}
