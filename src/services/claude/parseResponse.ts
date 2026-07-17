/**
 * Парсинг ответа Claude API: извлечение JSON из текста и валидация структуры.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { ParsedDocument, ProcessingResult } from '../../types/types';
import { config } from '../../config';
import { createScopedLogger } from '../logger';

const log = createScopedLogger('claude/parseResponse');

/**
 * Извлекает JSON из текстового ответа Claude и возвращает структурированный результат.
 * @param response Ответ от Anthropic API
 * @returns Результат обработки с данными документа или ошибкой
 */
export const parseClaudeResponse = (response: Anthropic.Message): ProcessingResult => {
	config.claudeApiStatus.consecutiveErrors = 0;

	if (response.content && response.content.length > 0) {
		const responseContent = response.content[0];

		if ('text' in responseContent) {
			const text = responseContent.text;
			const jsonMatch = text.match(/\{[\s\S]*\}/);

			if (jsonMatch) {
				try {
					const parsedData = JSON.parse(jsonMatch[0]) as ParsedDocument;
					return {
						success: true,
						data: parsedData,
					};
				} catch (jsonError) {
					log.error('Ошибка парсинга JSON из ответа Claude', { jsonError, filePath: 'unknown', response });
					return {
						success: false,
						error: 'Не удалось распарсить извлеченные данные из ответа Claude.',
					};
				}
			}

			return {
				success: false,
				error: 'Claude не вернул корректные JSON данные.',
			};
		}

		return {
			success: false,
			error: 'Claude API вернул неподдерживаемый тип контента.',
		};
	}

	return {
		success: false,
		error: 'Claude API вернул пустой ответ.',
	};
};
