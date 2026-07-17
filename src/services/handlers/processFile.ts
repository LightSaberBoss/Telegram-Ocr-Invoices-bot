/**
 * Оркестратор обработки входящего файла: статус → скачивание → Claude → ответ пользователю.
 */
import path from 'path';
import type TelegramBot from 'node-telegram-bot-api';
import type { Message } from 'node-telegram-bot-api';
import { MESSAGES } from '../../variables/messages';
import { config } from '../../config';
import { FileType, ProcessingContext } from '../../types/types';
import { deleteFileIfExists } from '../../utils/files';
import { processDocument } from '../claude/processDocument';
import { createScopedLogger } from '../logger';
import { getFileInfo, downloadFileContent } from './fileDownload';
import { sendInitialStatus, updateProcessingStatus } from './statusUpdates';
import { sendProcessingResult } from './sendResult';

const log = createScopedLogger('handlers/processFile');

/**
 * Универсальный пайплайн обработки файла (документ или фото).
 * @param bot Экземпляр Telegram бота
 * @param msg Сообщение с файлом
 * @param fileType Тип файла ('document' или 'photo')
 * @param fileName Имя файла для обработки
 */
export const processFile = async (bot: TelegramBot, msg: Message, fileType: FileType, fileName: string): Promise<void> => {
	const chatId = msg.chat.id;

	log.info('Начало обработки файла', { chatId, fileType, fileName });

	try {
		const fileInfo = await getFileInfo(bot, msg, fileType, fileName);

		const statusMessage = await sendInitialStatus(bot, chatId, fileType);
		const context: ProcessingContext = { chatId, fileType, fileName, statusMessage };

		await updateProcessingStatus(bot, context, 'downloading');
		const fileBuffer = await downloadFileContent(fileInfo);

		await updateProcessingStatus(bot, context, 'analyzing');
		const result = await processDocument(fileInfo.localPath, fileInfo.telegramPath, fileBuffer);
		log.info('Анализ завершен', { chatId, fileType, fileName });

		await updateProcessingStatus(bot, context, 'completed');
		await sendProcessingResult(bot, chatId, result, fileName);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
		const errorText = fileType === 'document' ? MESSAGES.ERROR_PROCESSING_DOCUMENT : MESSAGES.ERROR_PROCESSING_PHOTO;
		await bot.sendMessage(chatId, errorText);
		log.error(`Ошибка обработки ${fileType}`, { error, chatId, errorMessage });
	} finally {
		const localPath = path.join(config.paths.uploads, fileName);
		deleteFileIfExists(localPath);
	}
};
