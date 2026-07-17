/**
 * Обновление статуса обработки файла в Telegram-чате (редактирование сообщения).
 */
import type TelegramBot from 'node-telegram-bot-api';
import type { Message } from 'node-telegram-bot-api';
import { MESSAGES } from '../../variables/messages';
import { FileType, ProcessingContext, ProcessingStatus } from '../../types/types';

/**
 * Отправляет начальное сообщение о получении файла.
 * @param bot Экземпляр Telegram бота
 * @param chatId ID чата пользователя
 * @param fileType Тип файла (document или photo)
 * @returns Сообщение статуса для последующего редактирования
 */
export const sendInitialStatus = async (bot: TelegramBot, chatId: number, fileType: FileType): Promise<Message> => {
	const statusText = fileType === 'document' ? MESSAGES.STATUS_DOCUMENT_RECEIVED : MESSAGES.STATUS_PHOTO_RECEIVED;
	return await bot.sendMessage(chatId, statusText);
};

/**
 * Обновляет текст сообщения статуса в зависимости от этапа обработки.
 * @param bot Экземпляр Telegram бота
 * @param context Контекст обработки (chatId, тип файла, сообщение статуса)
 * @param status Текущий этап: downloading | analyzing | completed
 */
export const updateProcessingStatus = async (bot: TelegramBot, context: ProcessingContext, status: ProcessingStatus): Promise<void> => {
	const statusMessages = {
		downloading: context.fileType === 'document' ? MESSAGES.STATUS_DOWNLOADING_DOCUMENT : MESSAGES.STATUS_DOWNLOADING_PHOTO,
		analyzing: context.fileType === 'document' ? MESSAGES.STATUS_ANALYZING_DOCUMENT : MESSAGES.STATUS_ANALYZING_PHOTO,
		completed: MESSAGES.STATUS_PROCESSING_COMPLETED,
	};

	await bot.editMessageText(statusMessages[status], {
		chat_id: context.chatId,
		message_id: context.statusMessage.message_id,
	});
};
