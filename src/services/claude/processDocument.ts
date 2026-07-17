/**
 * Оркестратор распознавания документов через Claude API.
 * Координирует: health-check → подготовку медиа → запрос → парсинг ответа.
 */
import { ProcessingResult } from '../../types/types';
import { createScopedLogger } from '../logger';
import { checkApiHealth, waitForAvailableSlot, incrementActiveRequests, decrementActiveRequests, makeRequestWithRetry } from './apiClient';
import { prepareMediaForClaude } from './prepareMedia';
import { parseClaudeResponse } from './parseResponse';

const log = createScopedLogger('claude/processDocument');

/**
 * Основная функция для обработки документа через Claude API.
 * Поддерживает изображения, PDF и Excel файлы.
 * @param filePath Локальный путь к файлу
 * @param originalFilePath Исходный путь в Telegram (опционально)
 * @param fileBuffer Buffer с данными файла (для изображений и PDF без записи на диск)
 * @returns Результат обработки с извлеченными данными
 */
export const processDocument = async (
	filePath: string,
	originalFilePath?: string,
	fileBuffer?: Buffer,
): Promise<ProcessingResult> => {
	try {
		const healthCheck = checkApiHealth();
		if (healthCheck) {
			return healthCheck;
		}

		await waitForAvailableSlot();
		incrementActiveRequests();

		log.info(`Обработка документа через Claude API: ${filePath}`, { originalFilePath });

		const { mediaType, content } = await prepareMediaForClaude(filePath, fileBuffer);
		const response = await makeRequestWithRetry(mediaType, content);

		return parseClaudeResponse(response);
	} catch (error) {
		log.error('Ошибка обработки документа через Claude API', { error, filePath });
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Неизвестная ошибка в обработке Claude',
		};
	} finally {
		decrementActiveRequests();
	}
};
