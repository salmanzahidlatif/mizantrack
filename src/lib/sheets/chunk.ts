import { SHEETS_CHUNK_MAX_BYTES } from "@/lib/sheets/constants";
import { GoogleSheetsBackupError } from "@/lib/sheets/errors";

export interface SheetRowsChunk {
	startRow: number;
	rows: string[][];
}

function estimateRowsBytes(rows: readonly string[][]): number {
	return JSON.stringify({ values: rows }).length;
}

export function chunkSheetRows(
	rows: readonly string[][],
	maxBytes = SHEETS_CHUNK_MAX_BYTES
): SheetRowsChunk[] {
	const chunks: SheetRowsChunk[] = [];
	let current: string[][] = [];
	let currentStartRow = 1;

	for (const row of rows) {
		const nextRows = [...current, [...row]];
		if (estimateRowsBytes([[...row]]) > maxBytes) {
			throw new GoogleSheetsBackupError(
				"PayloadTooLarge",
				"A single spreadsheet row is too large for Google Sheets."
			);
		}

		if (current.length > 0 && estimateRowsBytes(nextRows) > maxBytes) {
			chunks.push({ startRow: currentStartRow, rows: current });
			currentStartRow += current.length;
			current = [[...row]];
			continue;
		}

		current = nextRows;
	}

	if (current.length > 0) chunks.push({ startRow: currentStartRow, rows: current });
	return chunks;
}
