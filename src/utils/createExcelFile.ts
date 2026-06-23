import * as XLSX from 'xlsx';
import { createScopedLogger } from '../services/logger';
import { ParsedDocument } from '../types/types';

const log = createScopedLogger('createExcelFile');

export function createExcelFileFromData(data: ParsedDocument, filePath: string): void {
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
}
