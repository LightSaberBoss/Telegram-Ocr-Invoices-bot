import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { createScopedLogger } from './logger';
import { handleDocument, handleHelp, handlePhoto, handleStart } from './botHandlers';

const log = createScopedLogger('telegramBot');

interface BotInstance {
	bot: TelegramBot | null;
	isRunning: boolean;
}

export const botInstance: BotInstance = {
	bot: null,
	isRunning: false,
};

/**
 * Инициализирует и запускает Telegram бота (один экземпляр на процесс)
 */
export const initializeBot = (): void => {
	if (botInstance.bot) {
		log.warn('Бот уже инициализирован, повторный запуск пропущен');
		return;
	}

	try {
		log.info('Инициализация Telegram бота...');

		botInstance.bot = new TelegramBot(config.telegram.token, {
			polling: {
				interval: 1000,
				autoStart: true,
				params: { timeout: 30 },
			},
		});

		setupHandlers();
		botInstance.isRunning = true;

		log.info('Telegram бот запущен, polling активен');
	} catch (error) {
		log.error('Ошибка инициализации бота', { error });
		throw error;
	}
};

/**
 * Настраивает обработчики событий для Telegram бота
 */
const setupHandlers = (): void => {
	const bot = botInstance.bot;

	if (!bot) {
		log.error('Невозможно настроить обработчики: бот не инициализирован');
		return;
	}

	bot.removeAllListeners();

	bot.onText(/\/start/, (msg) => handleStart(bot, msg));
	bot.onText(/\/help/, (msg) => handleHelp(bot, msg));
	bot.on('document', async (msg) => handleDocument(bot, msg));
	bot.on('photo', async (msg) => handlePhoto(bot, msg));
	bot.on('polling_error', handlePollingError);

	log.info('Обработчики событий настроены');
};

/**
 * Логирует ошибку поллинга. Библиотека node-telegram-bot-api сама повторяет запросы.
 */
const handlePollingError = (error: unknown): void => {
	const errorMessage = error instanceof Error ? error.message : String(error);
	const errorCode = error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : undefined;

	log.warn('Ошибка polling (бот продолжит работу автоматически)', {
		message: errorMessage,
		code: errorCode,
	});
};

/**
 * Останавливает polling без уничтожения экземпляра бота
 */
export const stopBot = (): void => {
	if (!botInstance.bot || !botInstance.isRunning) {
		log.warn('Остановка пропущена: бот не запущен');
		return;
	}

	try {
		log.info('Остановка polling...');
		botInstance.bot.stopPolling();
		botInstance.isRunning = false;
		log.info('Polling остановлен');
	} catch (error) {
		log.error('Ошибка остановки polling', { error });
	}
};

/**
 * Проверяет, что polling активен, и перезапускает его только если он остановился
 */
export const checkBotHealth = async (): Promise<void> => {
	if (!botInstance.bot) {
		log.warn('Health check: экземпляр бота отсутствует');
		return;
	}

	if (botInstance.bot.isPolling()) {
		log.debug('Health check: polling активен');
		return;
	}

	if (!botInstance.isRunning) {
		log.debug('Health check: бот остановлен намеренно');
		return;
	}

	try {
		log.warn('Health check: polling остановлен, пробуем startPolling()');
		await botInstance.bot.startPolling();
		log.info('Health check: polling восстановлен');
	} catch (error) {
		log.error('Health check: не удалось восстановить polling', { error });
	}
};
