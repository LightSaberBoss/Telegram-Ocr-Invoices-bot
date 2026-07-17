/**
 * Обработчики текстовых команд бота: /start и /help.
 */
import type TelegramBot from 'node-telegram-bot-api';
import type { Message } from 'node-telegram-bot-api';
import { MESSAGES } from '../../variables/messages';
import { createScopedLogger } from '../logger';

const log = createScopedLogger('handlers/commands');

/**
 * Обрабатывает команду /start — отправляет приветственное сообщение.
 * @param bot Экземпляр Telegram бота
 * @param msg Сообщение от пользователя
 */
export const handleStart = async (bot: TelegramBot, msg: Message): Promise<void> => {
	const chatId = msg.chat.id;

	try {
		log.info(`Начало работы с пользователем: ${chatId}`);
		await bot.sendMessage(chatId, MESSAGES.START_MESSAGE);
	} catch (error) {
		log.error('Ошибка обработки команды /start', { error, chatId });
	}
};

/**
 * Обрабатывает команду /help — отправляет справочное сообщение.
 * @param bot Экземпляр Telegram бота
 * @param msg Сообщение от пользователя
 */
export const handleHelp = async (bot: TelegramBot, msg: Message): Promise<void> => {
	const chatId = msg.chat.id;

	try {
		await bot.sendMessage(chatId, MESSAGES.HELP_MESSAGE);
	} catch (error) {
		log.error('Ошибка обработки команды /help', { error, chatId });
	}
};
