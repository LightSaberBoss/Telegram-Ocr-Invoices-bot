/**
 * Клиент Anthropic API: запросы, лимит параллелизма, retry при 429/529 и health-check.
 */
import Anthropic from '@anthropic-ai/sdk';
import { ProcessingResult } from '../../types/types';
import { config } from '../../config';
import { createScopedLogger } from '../logger';
import { BASE_PROMPT, EXTRACT_INVOICE_TOOL, EXTRACT_INVOICE_TOOL_NAME, SYSTEM_PROMPT } from './prompt';

const log = createScopedLogger('claude/apiClient');

const anthropic = new Anthropic({
	apiKey: config.claude.apiKey,
});

/** Счётчик активных запросов к API (для ограничения параллелизма) */
let activeRequests = 0;

const RETRY_CONFIG = {
	MAX_RETRIES: 3,
	INITIAL_DELAY: 5000,
	DELAY_MULTIPLIER: 2,
} as const;

/** Общие параметры запроса: system + принудительный tool_use для JSON-схемы */
const getCommonRequestOptions = () => ({
	model: config.claude.model || 'claude-sonnet-4-6',
	max_tokens: config.claude.maxTokens || 20000,
	system: SYSTEM_PROMPT,
	tools: [EXTRACT_INVOICE_TOOL],
	tool_choice: {
		type: 'tool' as const,
		name: EXTRACT_INVOICE_TOOL_NAME,
		disable_parallel_tool_use: true,
	},
});

/**
 * Проверяет, не находится ли API в режиме охлаждения после серии ошибок.
 * @returns Ошибку для пользователя или null, если API доступен
 */
export const checkApiHealth = (): ProcessingResult | null => {
	if (config.claudeApiStatus && !config.claudeApiStatus.isHealthy) {
		const timeSinceError = Date.now() - config.claudeApiStatus.lastErrorTime;
		if (timeSinceError < config.claudeApiStatus.cooldownPeriod) {
			log.warn(`Claude API в режиме охлаждения. Подождите ${Math.ceil((config.claudeApiStatus.cooldownPeriod - timeSinceError) / 1000)} секунд.`);
			return {
				success: false,
				error: `API Claude временно недоступно. Повторите запрос через ${Math.ceil((config.claudeApiStatus.cooldownPeriod - timeSinceError) / 1000)} секунд.`,
			};
		}

		config.claudeApiStatus.isHealthy = true;
		config.claudeApiStatus.consecutiveErrors = 0;
	}

	return null;
};

/**
 * Ожидает свободный слот, если достигнут лимит параллельных запросов.
 */
export const waitForAvailableSlot = async (): Promise<void> => {
	const maxRequests = config.maxParallelRequests || 3;

	while (activeRequests >= maxRequests) {
		log.info(`Достигнут лимит параллельных запросов (${maxRequests}). Ожидание...`);
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
};

/** Увеличивает счётчик активных запросов */
export const incrementActiveRequests = (): void => {
	activeRequests++;
};

/** Уменьшает счётчик активных запросов (не ниже 0) */
export const decrementActiveRequests = (): void => {
	activeRequests = Math.max(0, activeRequests - 1);
};

/**
 * Создаёт мультимодальный запрос к Claude для изображения.
 * @param content Buffer с JPEG-изображением
 */
const createImageRequest = async (content: Buffer): Promise<Anthropic.Message> => {
	const base64Image = content.toString('base64');

	return await anthropic.messages.create({
		...getCommonRequestOptions(),
		messages: [
			{
				role: 'user',
				content: [
					{ type: 'text', text: BASE_PROMPT },
					{
						type: 'image',
						source: {
							type: 'base64',
							media_type: 'image/jpeg',
							data: base64Image,
						},
					},
				],
			},
		],
	});
};

/**
 * Создаёт мультимодальный запрос к Claude для PDF (native document block).
 * @param content Buffer с PDF данными
 */
const createPdfRequest = async (content: Buffer): Promise<Anthropic.Message> => {
	const base64Pdf = content.toString('base64');

	return await anthropic.messages.create({
		...getCommonRequestOptions(),
		messages: [
			{
				role: 'user',
				content: [
					{ type: 'text', text: BASE_PROMPT },
					{
						type: 'document',
						source: {
							type: 'base64',
							media_type: 'application/pdf',
							data: base64Pdf,
						},
					},
				],
			},
		],
	});
};

/**
 * Создаёт текстовый запрос к Claude для Excel (CSV, извлечённый из таблицы).
 * @param content Текст документа в формате CSV
 */
const createTextRequest = async (content: string): Promise<Anthropic.Message> => {
	return await anthropic.messages.create({
		...getCommonRequestOptions(),
		messages: [
			{
				role: 'user',
				content: `${BASE_PROMPT}\n\nСодержание документа (Excel → CSV):\n\n${content}`,
			},
		],
	});
};

/**
 * Обрабатывает ошибки API с механизмом повторных попыток (429, 529).
 * @throws Ошибку с флагами retry или исходную ошибку
 */
const handleApiError = async (error: any, retryCount: number, retryDelay: number): Promise<never> => {
	if ((error.status === 529 || error.status === 429) && retryCount < RETRY_CONFIG.MAX_RETRIES) {
		const newRetryCount = retryCount + 1;
		log.warn(`Получена ошибка API ${error.status}, повторная попытка ${newRetryCount}/${RETRY_CONFIG.MAX_RETRIES} через ${retryDelay / 1000}с`);

		config.claudeApiStatus.consecutiveErrors++;

		if (error.status === 429 && error.headers && error.headers['retry-after']) {
			const retryAfterHeader = error.headers['retry-after'];
			let retryAfter;

			try {
				retryAfter = parseInt(retryAfterHeader) * 1000;
				if (isNaN(retryAfter) || retryAfter <= 0) {
					retryAfter = retryDelay;
					log.warn(`Некорректный заголовок retry-after: ${retryAfterHeader}, используем задержку по умолчанию: ${retryDelay}мс`);
				}
			} catch (parseError) {
				retryAfter = retryDelay;
				log.warn(`Ошибка парсинга заголовка retry-after: ${retryAfterHeader}, используем задержку по умолчанию: ${retryDelay}мс`);
			}

			log.info(`Ожидание ${retryAfter / 1000}с как указано в заголовке retry-after`);
			await new Promise((resolve) => setTimeout(resolve, retryAfter));
		} else {
			await new Promise((resolve) => setTimeout(resolve, retryDelay));
		}

		if (config.claudeApiStatus.consecutiveErrors >= 3) {
			config.claudeApiStatus.isHealthy = false;
			config.claudeApiStatus.lastErrorTime = Date.now();
			log.warn(`Claude API помечен как недоступный. Режим охлаждения на ${config.claudeApiStatus.cooldownPeriod / 1000} секунд.`);
		}

		throw { ...error, retryCount: newRetryCount, retryDelay: retryDelay * RETRY_CONFIG.DELAY_MULTIPLIER };
	}

	config.claudeApiStatus.consecutiveErrors++;
	if (config.claudeApiStatus.consecutiveErrors >= 3) {
		config.claudeApiStatus.isHealthy = false;
		config.claudeApiStatus.lastErrorTime = Date.now();
	}

	throw error;
};

/**
 * Выполняет запрос к Claude API с автоматическими повторными попытками.
 * @param mediaType Тип медиа: image, pdf или excel
 * @param content Подготовленное содержимое
 * @returns Ответ от Anthropic API
 */
export const makeRequestWithRetry = async (mediaType: string, content: Buffer | string): Promise<Anthropic.Message> => {
	let retryCount = 0;
	let retryDelay = RETRY_CONFIG.INITIAL_DELAY;

	while (true) {
		try {
			if (mediaType === 'image') {
				return await createImageRequest(content as Buffer);
			}

			if (mediaType === 'pdf') {
				return await createPdfRequest(content as Buffer);
			}

			return await createTextRequest(content as string);
		} catch (error: any) {
			if (error.retryCount !== undefined) {
				retryCount = error.retryCount;
				retryDelay = error.retryDelay;
			}

			await handleApiError(error, retryCount, retryDelay);
		}
	}
};
