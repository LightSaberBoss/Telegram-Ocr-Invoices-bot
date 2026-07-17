/**
 * Подготовка входных файлов перед отправкой в Claude API.
 * Конвертирует изображения, готовит PDF для native document block, извлекает CSV из Excel.
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { createScopedLogger } from '../logger';
import { extractTextFromExcel } from '../../utils/excel';

const log = createScopedLogger('claude/prepareMedia');

/** Максимальный размер PDF для отправки в Claude API (32 MB) */
const MAX_PDF_SIZE_BYTES = 32 * 1024 * 1024;

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
 * Подготавливает PDF для отправки в Claude API как native document block.
 * @param input Путь к PDF файлу или Buffer с PDF данными
 * @returns Buffer с PDF данными
 */
export const preparePdfForClaude = async (input: string | Buffer): Promise<Buffer> => {
	try {
		let dataBuffer: Buffer;

		if (Buffer.isBuffer(input)) {
			dataBuffer = input;
			log.info('preparePdfForClaude: Обработка PDF из памяти (Buffer)');
		} else {
			dataBuffer = fs.readFileSync(input);
			log.info(`preparePdfForClaude: Обработка PDF из файла: ${input}`);
		}

		if (dataBuffer.length > MAX_PDF_SIZE_BYTES) {
			throw new Error(`PDF слишком большой (${Math.round(dataBuffer.length / 1024 / 1024)} MB). Максимум: 32 MB.`);
		}

		return dataBuffer;
	} catch (error) {
		if (error instanceof Error && error.message.includes('PDF слишком большой')) {
			throw error;
		}

		log.error('Ошибка подготовки PDF', { error, inputType: Buffer.isBuffer(input) ? 'Buffer' : 'file' });
		throw new Error('Не удалось подготовить PDF для отправки');
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
		const pdfBuffer = await preparePdfForClaude(input);
		return { mediaType: 'pdf', content: pdfBuffer };
	}

	if (['.xls', '.xlsx', '.csv'].includes(extension)) {
		const input = fileBuffer || filePath;
		const text = await extractTextFromExcel(input);
		const formattedText = `=== Excel документ (CSV) ===\n\n${text}`;
		return { mediaType: 'excel', content: formattedText };
	}

	throw new Error(`Unsupported file format: ${extension}`);
};
