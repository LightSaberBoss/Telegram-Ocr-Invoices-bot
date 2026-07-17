/**
 * Подготовка входных файлов перед отправкой в Claude API.
 * Конвертирует изображения, извлекает текст из PDF и Excel.
 */
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import pdfParse from 'pdf-parse';
import sharp from 'sharp';
import { createScopedLogger } from '../logger';

const log = createScopedLogger('claude/prepareMedia');

export type MediaType = 'image' | 'pdf' | 'excel' | 'unknown';

export interface PreparedMedia {
	mediaType: MediaType;
	content: Buffer | string;
}

/**
 * Преобразует изображение в формат и размер, подходящий для отправки в API Claude.
 * Claude может принимать изображения размером до 5MB.
 * @param input Путь к файлу изображения или Buffer с данными изображения
 * @returns Buffer с оптимизированным изображением
 */
export const prepareImageForClaude = async (input: string | Buffer): Promise<Buffer> => {
	try {
		let image: sharp.Sharp;

		if (Buffer.isBuffer(input)) {
			image = sharp(input);
			log.info('prepareImageForClaude: Обработка изображения из памяти (Buffer)');
		} else {
			image = sharp(input);
			log.info(`prepareImageForClaude: Обработка изображения из файла: ${input}`);
		}

		const metadata = await image.metadata();

		if ((metadata.width && metadata.width > 1500) || (metadata.height && metadata.height > 1500)) {
			return await image.resize(1500, 1500, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
		}

		return await image.jpeg({ quality: 85 }).toBuffer();
	} catch (error) {
		log.error('Ошибка подготовки изображения', { error, inputType: Buffer.isBuffer(input) ? 'Buffer' : 'file' });

		if (Buffer.isBuffer(input)) {
			return input;
		}

		return fs.readFileSync(input);
	}
};

/**
 * Извлекает текст из PDF файла или Buffer.
 * @param input Путь к PDF файлу или Buffer с PDF данными
 * @returns Извлеченный текст и количество страниц
 */
export const extractTextFromPdf = async (input: string | Buffer): Promise<{ text: string; pageCount: number }> => {
	try {
		let dataBuffer: Buffer;

		if (Buffer.isBuffer(input)) {
			dataBuffer = input;
			log.info('extractTextFromPdf: Обработка PDF из памяти (Buffer)');
		} else {
			dataBuffer = fs.readFileSync(input);
			log.info(`extractTextFromPdf: Обработка PDF из файла: ${input}`);
		}

		const pdfData = await pdfParse(dataBuffer);

		return {
			text: pdfData.text,
			pageCount: pdfData.numpages,
		};
	} catch (error) {
		log.error('Ошибка извлечения текста из PDF', { error, inputType: Buffer.isBuffer(input) ? 'Buffer' : 'file' });
		throw new Error('Не удалось извлечь текст из PDF');
	}
};

/**
 * Извлекает текст из файла Excel.
 * @param filePath Путь к файлу Excel
 * @returns Извлеченный текст в виде строки
 */
export const extractTextFromExcel = async (filePath: string): Promise<string> => {
	try {
		const workbook = XLSX.readFile(filePath);
		let extractedText = '';

		for (const sheetName of workbook.SheetNames) {
			const worksheet = workbook.Sheets[sheetName];
			extractedText += `=== Лист: ${sheetName} ===\n`;

			const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

			for (const row of jsonData) {
				if (Array.isArray(row) && row.length > 0) {
					extractedText += row.map((cell) => (cell !== undefined && cell !== null ? cell.toString() : '')).join('\t') + '\n';
				}
			}

			extractedText += '\n';
		}

		return extractedText;
	} catch (error) {
		log.error('Ошибка извлечения текста из Excel', { error, filePath });
		throw new Error('Не удалось извлечь текст из Excel');
	}
};

/**
 * Определяет тип файла по расширению и подготавливает данные для Claude API.
 * @param filePath Путь к файлу
 * @param fileBuffer Опциональный Buffer (для изображений и PDF без записи на диск)
 * @returns Тип медиа и подготовленное содержимое
 */
export const prepareMediaForClaude = async (filePath: string, fileBuffer?: Buffer): Promise<PreparedMedia> => {
	const extension = path.extname(filePath).toLowerCase();

	if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(extension)) {
		const input = fileBuffer || filePath;
		const optimizedImage = await prepareImageForClaude(input);
		return { mediaType: 'image', content: optimizedImage };
	}

	if (extension === '.pdf') {
		const input = fileBuffer || filePath;
		const { text, pageCount } = await extractTextFromPdf(input);
		const formattedText = `=== PDF документ (${pageCount} страниц) ===\n\n${text}`;
		return { mediaType: 'pdf', content: formattedText };
	}

	if (['.xls', '.xlsx', '.csv'].includes(extension)) {
		const text = await extractTextFromExcel(filePath);
		const formattedText = `=== Excel документ ===\n\n${text}`;
		return { mediaType: 'excel', content: formattedText };
	}

	throw new Error(`Unsupported file format: ${extension}`);
};
