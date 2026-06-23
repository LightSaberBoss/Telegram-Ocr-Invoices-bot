import fs from 'fs';
import path from 'path';
import type TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { createScopedLogger } from './logger';
import { handleDocument, handleHelp, handlePhoto, handleStart } from './botHandlers';

const log = createScopedLogger('telegramBot');
const BOT_LOCK_FILE_PATH = path.resolve(process.cwd(), '.telegram-bot.lock');

type TelegramBotConstructor = typeof import('node-telegram-bot-api').default;
let telegramBotConstructor: TelegramBotConstructor | null = null;
let lockFileDescriptor: number | null = null;
const nativeDynamicImport = new Function('modulePath', 'return import(modulePath)') as (
	modulePath: string,
) => Promise<{ default: TelegramBotConstructor }>;

const loadTelegramBotConstructor = async (): Promise<TelegramBotConstructor> => {
	if (telegramBotConstructor) {
		return telegramBotConstructor;
	}

	const telegramBotModule = await nativeDynamicImport('node-telegram-bot-api');
	telegramBotConstructor = telegramBotModule.default;
	return telegramBotConstructor;
};

interface BotInstance {
	bot: TelegramBot | null;
	isRunning: boolean;
}

export const botInstance: BotInstance = {
	bot: null,
	isRunning: false,
};

/**
 * Проверяет, существует ли процесс по PID
 */
const isProcessRunning = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		return code === 'EPERM';
	}
};

/**
 * Читает PID из lock-файла
 */
const getLockedPid = (): number | null => {
	try {
		const lockFileContent = fs.readFileSync(BOT_LOCK_FILE_PATH, 'utf8').trim();
		const pid = Number(lockFileContent);
		return Number.isInteger(pid) && pid > 0 ? pid : null;
	} catch {
		return null;
	}
};

/**
 * Захватывает lock на запуск polling (один процесс на один бот)
 */
const acquireBotLock = (): void => {
	try {
		lockFileDescriptor = fs.openSync(BOT_LOCK_FILE_PATH, 'wx');
		fs.writeFileSync(lockFileDescriptor, `${process.pid}\n`);
		log.info('Получен lock запуска бота', { lockFile: BOT_LOCK_FILE_PATH, pid: process.pid });
		return;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== 'EEXIST') {
			throw error;
		}
	}

	const lockedPid = getLockedPid();
	if (lockedPid && isProcessRunning(lockedPid)) {
		throw new Error(`Бот уже запущен в другом процессе (PID ${lockedPid}). Второй экземпляр остановлен.`);
	}

	// Lock-файл остался от старого процесса, который уже завершился
	try {
		fs.unlinkSync(BOT_LOCK_FILE_PATH);
		log.warn('Удален устаревший lock-файл запуска бота', { lockFile: BOT_LOCK_FILE_PATH, lockedPid });
	} catch {
		// Игнорируем: повторная попытка ниже выбросит понятную ошибку при неудаче
	}

	lockFileDescriptor = fs.openSync(BOT_LOCK_FILE_PATH, 'wx');
	fs.writeFileSync(lockFileDescriptor, `${process.pid}\n`);
	log.info('Получен lock запуска бота после очистки устаревшего lock-файла', {
		lockFile: BOT_LOCK_FILE_PATH,
		pid: process.pid,
	});
};

/**
 * Освобождает lock запуска бота
 */
const releaseBotLock = (): void => {
	if (lockFileDescriptor !== null) {
		try {
			fs.closeSync(lockFileDescriptor);
		} catch {
			// Ничего не делаем, продолжаем освобождение lock-файла
		}
		lockFileDescriptor = null;
	}

	try {
		if (fs.existsSync(BOT_LOCK_FILE_PATH)) {
			fs.unlinkSync(BOT_LOCK_FILE_PATH);
			log.info('Lock запуска бота освобожден', { lockFile: BOT_LOCK_FILE_PATH });
		}
	} catch (error) {
		log.warn('Не удалось удалить lock-файл запуска бота', { error, lockFile: BOT_LOCK_FILE_PATH });
	}
};

/**
 * Инициализирует и запускает Telegram бота (один экземпляр на процесс)
 */
export const initializeBot = async (): Promise<void> => {
	if (botInstance.bot) {
		log.warn('Бот уже инициализирован, повторный запуск пропущен');
		return;
	}

	try {
		log.info('Инициализация Telegram бота...');
		acquireBotLock();
		const TelegramBotClass = await loadTelegramBotConstructor();

		botInstance.bot = new TelegramBotClass(config.telegram.token, {
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
		releaseBotLock();
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
	if (!botInstance.isRunning) {
		return;
	}

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
export const stopBot = async (): Promise<void> => {
	if (!botInstance.bot || !botInstance.isRunning) {
		log.warn('Остановка пропущена: бот не запущен');
		return;
	}

	try {
		const bot = botInstance.bot;
		log.info('Остановка polling...');
		bot.removeListener('polling_error', handlePollingError);
		await bot.stopPolling();
		botInstance.isRunning = false;
		botInstance.bot = null;
		releaseBotLock();
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

process.on('exit', () => {
	releaseBotLock();
});
