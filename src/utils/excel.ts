/**
 * Утилиты для работы с Excel (SheetJS): чтение, даты, CSV, запись результата.
 */
import * as XLSX from 'xlsx';
import { createScopedLogger } from '../services/logger';
import { ParsedDocument } from '../types/types';

const log = createScopedLogger('utils/excel');

/**
 * Форматирует даты в worksheet в DD.MM.YYYY перед конвертацией в CSV.
 * @param worksheet Лист Excel
 */
export const formatWorksheetDates = (worksheet: XLSX.WorkSheet): void => {
	if (!worksheet['!ref']) {
		return;
	}

	const range = XLSX.utils.decode_range(worksheet['!ref']);

	for (let row = range.s.r; row <= range.e.r; row++) {
		for (let col = range.s.c; col <= range.e.c; col++) {
			const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
			const cell = worksheet[cellAddress];

			if (!cell || cell.t !== 'd' || !(cell.v instanceof Date)) {
				continue;
			}

			const date = cell.v;
			const day = String(date.getDate()).padStart(2, '0');
			const month = String(date.getMonth() + 1).padStart(2, '0');
			const year = date.getFullYear();

			cell.v = `${day}.${month}.${year}`;
			cell.t = 's';
			cell.w = cell.v;
		}
	}
};

/**
 * Читает workbook из файла или Buffer.
 * @param input Путь к файлу или Buffer
 */
export const readWorkbook = (input: string | Buffer): XLSX.WorkBook => {
	if (Buffer.isBuffer(input)) {
		log.info('Чтение Excel из памяти (Buffer)');
		return XLSX.read(input, { type: 'buffer', cellDates: true });
	}

	log.info(`Чтение Excel из файла: ${input}`);
	return XLSX.readFile(input, { cellDates: true });
};

/**
 * Извлекает текст из Excel в формате CSV (по листам).
 * @param input Путь к файлу Excel или Buffer
 */
export const extractTextFromExcel = async (input: string | Buffer): Promise<string> => {
	try {
		const workbook = readWorkbook(input);
		let extractedText = '';

		for (const sheetName of workbook.SheetNames) {
			const worksheet = workbook.Sheets[sheetName];
			formatWorksheetDates(worksheet);

			extractedText += `=== Лист: ${sheetName} ===\n`;
			extractedText += XLSX.utils.sheet_to_csv(worksheet);
			extractedText += '\n\n';
		}

		return extractedText.trim();
	} catch (error) {
		log.error('Ошибка извлечения текста из Excel', {
			error,
			inputType: Buffer.isBuffer(input) ? 'Buffer' : 'file',
		});
		throw new Error('Не удалось извлечь текст из Excel');
	}
};

/**
 * Создаёт Excel-файл результата распознавания.
 * @param data Распознанные данные документа
 * @param filePath Путь для сохранения .xlsx
 */
export const createExcelFileFromData = (data: ParsedDocument, filePath: string): void => {
	try {
		log.info('Создание Excel файла', { filePath });

		const workbook = XLSX.utils.book_new();
		const sheetData: unknown[][] = [];

		sheetData.push(['ИНФОРМАЦИЯ О ДОКУМЕНТЕ']);
		sheetData.push([]);
		sheetData.push(['Номер счета', data.invoice_number || '']);
		sheetData.push(['Дата', data.invoice_date || '']);
		sheetData.push(['ЕДРПОУ', data.edrpou || '']);
		sheetData.push(['ИПН', data.ipn || '']);
		sheetData.push(['Поставщик', data.supplier || '']);
		sheetData.push(['Цены с НДС', data.isPriceWithPdv ? 'Да' : 'Нет']);
		sheetData.push([]);
		sheetData.push([]);
		sheetData.push(['СПИСОК ТОВАРОВ']);
		sheetData.push([]);

		const itemsHeaders = ['№', 'Наименование', 'Артикул', 'Количество', 'Ед. изм.', 'Цена без НДС', 'Цена с НДС', 'Сумма без НДС', 'Сумма с НДС'];
		sheetData.push(itemsHeaders);

		if (data.items && data.items.length > 0) {
			data.items.forEach((item, index) => {
				sheetData.push([
					index + 1,
					item.name || '',
					item.article || '',
					item.quantity || 0,
					item.unit || '',
					item.price_no_pdv || 0,
					item.price_with_pdv || 0,
					item.total_no_pdv || 0,
					item.total_with_pdv || 0,
				]);
			});
		}

		sheetData.push([]);
		sheetData.push(['', '', '', '', '', '', 'ИТОГО:', data.total_no_pdv || 0, data.total_with_pdv || 0]);
		sheetData.push(['', '', '', '', '', '', 'НДС:', data.total_pdv || 0, '']);

		const sheet = XLSX.utils.aoa_to_sheet(sheetData);
		sheet['!cols'] = [
			{ wch: 5 },
			{ wch: 40 },
			{ wch: 15 },
			{ wch: 10 },
			{ wch: 10 },
			{ wch: 12 },
			{ wch: 12 },
			{ wch: 12 },
			{ wch: 12 },
		];

		if (!sheet['!merges']) {
			sheet['!merges'] = [];
		}

		sheet['!merges'].push(
			{ s: { r: 0, c: 0 }, e: { r: 0, c: 8 } },
			{ s: { r: 8, c: 0 }, e: { r: 8, c: 8 } },
		);

		XLSX.utils.book_append_sheet(workbook, sheet, 'Документ');
		XLSX.writeFile(workbook, filePath);

		log.info('Excel файл создан', { filePath, itemsCount: data.items?.length || 0 });
	} catch (error) {
		log.error('Ошибка создания Excel файла', { error, filePath });
		throw error;
	}
};
