/**
 * Excel on the phone (SheetJS): template download, reading picked files, export. All offline.
 */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { IMPORT_TEMPLATE_AR } from '@daftarak/shared';
import { getDb } from '../../db/client';
import { exportProductRows } from '../../domain/inventory/import';

/** SheetJS is ~1 MB: required on first use only, so it never slows the app start. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const xlsx = (): typeof import('xlsx') => require('xlsx');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function shareWorkbook(rows: (string | number)[][], fileName: string, sheetName: string) {
  const ws = xlsx().utils.aoa_to_sheet(rows);
  ws['!cols'] = rows[0]!.map((h) => ({ wch: Math.max(12, String(h).length + 4) }));
  // Right-to-left sheet for Arabic users.
  const wb = xlsx().utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  xlsx().utils.book_append_sheet(wb, ws, sheetName);
  const b64 = xlsx().write(wb, { type: 'base64', bookType: 'xlsx' }) as string;
  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(b64, { encoding: 'base64' });
  await Sharing.shareAsync(file.uri, { mimeType: XLSX_MIME, dialogTitle: fileName, UTI: 'org.openxmlformats.spreadsheetml.sheet' });
}

export async function shareImportTemplate() {
  await shareWorkbook([IMPORT_TEMPLATE_AR.headers, IMPORT_TEMPLATE_AR.example], 'daftarak-products-template.xlsx', 'المنتجات');
}

export async function exportProductsToExcel(includeCost: boolean) {
  const rows = await exportProductRows(getDb(), includeCost);
  const stamp = new Date().toISOString().slice(0, 10);
  await shareWorkbook(rows, `daftarak-products-${stamp}.xlsx`, 'المنتجات');
}

export interface PickedSheet {
  fileName: string;
  sheetNames: string[];
  /** rows of the chosen sheet, first row = headers */
  rows: unknown[][];
}

/** Pick an .xlsx/.xls/.csv file and read its first sheet. Returns null if cancelled. */
export async function pickSpreadsheet(): Promise<PickedSheet | null> {
  const r = await DocumentPicker.getDocumentAsync({
    type: [XLSX_MIME, 'application/vnd.ms-excel', 'text/csv', 'text/comma-separated-values', 'application/octet-stream'],
    copyToCacheDirectory: true,
  });
  if (r.canceled || !r.assets?.[0]) return null;
  const asset = r.assets[0];
  const b64 = await new File(asset.uri).base64();
  const wb = xlsx().read(b64, { type: 'base64', cellDates: false, codepage: 65001 });
  const first = wb.SheetNames[0]!;
  const rows = xlsx().utils.sheet_to_json<unknown[]>(wb.Sheets[first]!, { header: 1, raw: true, blankrows: false, defval: null });
  return { fileName: asset.name, sheetNames: wb.SheetNames, rows };
}
