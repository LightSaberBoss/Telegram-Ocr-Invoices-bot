/**
 * Извлечение structured данных из ответа Claude (tool_use extract_invoice).
 */
import type Anthropic from '@anthropic-ai/sdk';
import { ParsedDocument, ProcessingResult } from '../../types/types';
import { config } from '../../config';
import { createScopedLogger } from '../logger';
import { EXTRACT_INVOICE_TOOL_NAME } from './prompt';

const log = createScopedLogger('claude/parseResponse');

/**
 * Берёт input из tool_use extract_invoice.
 * @param response Ответ от Anthropic API
 */
export const parseClaudeResponse = (response: Anthropic.Message): ProcessingResult => {
	config.claudeApiStatus.consecutiveErrors = 0;

	const toolBlock = response.content?.find(
		(block): block is Anthropic.ToolUseBlock =>
			block.type === 'tool_use' && block.name === EXTRACT_INVOICE_TOOL_NAME,
	);

	if (!toolBlock) {
		log.error('В ответе Claude нет tool_use extract_invoice', { response });
		return {
			success: false,
			error: 'Claude не вернул структурированные данные.',
		};
	}

	return {
		success: true,
		data: toolBlock.input as ParsedDocument,
	};
};
