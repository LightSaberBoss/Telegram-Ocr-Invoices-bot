import { createScopedLogger } from '../services/logger';
import { config } from '../config';
import fs from 'fs';

const log = createScopedLogger('files');

export async function downloadFile(filePath: string, destination: string): Promise<void> {
	try {
		log.info('Скачивание файла на диск', { filePath, destination });

		const response = await fetch(`https://api.telegram.org/file/bot${config.telegram.token}/${filePath}`);

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const buffer = await response.arrayBuffer();
		fs.writeFileSync(destination, Buffer.from(buffer));

		log.info('Файл сохранен на диск', { destination, sizeBytes: buffer.byteLength });
	} catch (error) {
		log.error('Ошибка скачивания файла на диск', { error, filePath, destination });
		throw error;
	}
}

export async function downloadFileToBuffer(filePath: string): Promise<Buffer> {
	try {
		log.info('Скачивание файла в память', { filePath });

		const response = await fetch(`https://api.telegram.org/file/bot${config.telegram.token}/${filePath}`);

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const arrayBuffer = await response.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);

		log.info('Файл загружен в память', { filePath, sizeBytes: buffer.length });
		return buffer;
	} catch (error) {
		log.error('Ошибка скачивания файла в память', { error, filePath });
		throw error;
	}
}

export function normalizeFileName(fileName: string): string {
	let normalized = fileName
		.replace(/[\\/:*?"<>|]/g, '_')
		.replace(/\s+/g, '_')
		.replace(/_+/g, '_');

	const MAX_PART_LENGTH = 30;
	const parts = normalized.split('_');
	const shortenedParts = parts.map((part) => (part.length > MAX_PART_LENGTH ? part.substring(0, MAX_PART_LENGTH - 3) + '...' : part));

	normalized = shortenedParts.join('_');
	if (normalized.length > 100) {
		normalized = normalized.substring(0, 97) + '...';
	}

	return normalized || `file_${Date.now()}`;
}

export function deleteFileIfExists(filePath: string): void {
	if (!filePath || !fs.existsSync(filePath)) {
		return;
	}

	try {
		fs.unlinkSync(filePath);
		log.debug('Файл удален', { filePath });
	} catch (error) {
		log.warn('Не удалось удалить файл', { error, filePath });
	}
}

export function safeDeleteFile(filePath: string): void {
	if (!filePath || typeof filePath !== 'string' || filePath.trim() === '') {
		log.warn('Пропуск удаления: некорректный путь', { filePath });
		return;
	}

	const maxRetries = 3;
	let retryCount = 0;
	let isDeleting = false;

	const attemptDelete = () => {
		if (isDeleting) {
			return;
		}

		isDeleting = true;

		try {
			if (fs.existsSync(filePath)) {
				fs.unlinkSync(filePath);
				log.debug('Временный файл удален', { filePath });
			}

			isDeleting = false;
		} catch (error) {
			if (retryCount < maxRetries) {
				retryCount++;
				const retryDelay = 1000 * retryCount;
				log.warn(`Повтор удаления файла (${retryCount}/${maxRetries})`, { filePath, retryDelay });

				setTimeout(() => {
					isDeleting = false;
					attemptDelete();
				}, retryDelay);
				return;
			}

			log.error('Не удалось удалить файл после всех попыток', { error, filePath, maxRetries });
			isDeleting = false;
		}
	};

	setTimeout(attemptDelete, 500);
}
