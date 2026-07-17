/**
 * Точки входа для входящих медиа: документы и фотографии.
 * Делегируют обработку в processFile.
 */
import type TelegramBot from 'node-telegram-bot-api';
import type { Message } from 'node-telegram-bot-api';
import { MESSAGES } from '../../variables/messages';
import { createScopedLogger } from '../logger';
import { processFile } from './processFile';

const log = createScopedLogger('handlers/mediaHandlers');

/**
 * Обрабатывает входящий документ (PDF, Excel, изображение как файл).
 * @param bot Экземпляр Telegram бота
 * @param msg Сообщение с документом
 */
export const handleDocument = async (bot: TelegramBot, msg: Message): Promise<void> => {
	const chatId = msg.chat.id;
	const fileId = msg.document?.file_id;

	if (!fileId || !msg.document) {
		await bot.sendMessage(chatId, MESSAGES.ERROR_INVALID_DOCUMENT);
		log.warn(`Получен некорректный документ от чата ${chatId}`);
		return;
	}

	await processFile(bot, msg, 'document', msg.document.file_name || 'document');
};

/**
 * Обрабатывает входящую фотографию (берёт максимальное разрешение).
 * @param bot Экземпляр Telegram бота
 * @param msg Сообщение с фото
 */
export const handlePhoto = async (bot: TelegramBot, msg: Message): Promise<void> => {
	const chatId = msg.chat.id;
	const photos = msg.photo;

	if (!photos || photos.length === 0) {
		await bot.sendMessage(chatId, MESSAGES.ERROR_INVALID_PHOTO);
		log.warn(`Получено некорректное фото от чата ${chatId}`);
		return;
	}

	const fileName = `photo_${Date.now()}.jpg`;
	await processFile(bot, msg, 'photo', fileName);
};
