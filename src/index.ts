import { initializeBot, stopBot } from './services/telegramBot';
import { createScopedLogger } from './services/logger';
import { setupDefaultDirectories } from './utils/directories';

const log = createScopedLogger('index');

const APP_CONFIG = {
	GRACEFUL_SHUTDOWN_TIMEOUT: 10000,
	isShuttingDown: false,
};

const handleUncaughtException = (error: Error): void => {
	log.error('Необработанное исключение', {
		message: error.message,
		stack: error.stack,
	});
};

const handleUnhandledRejection = (reason: unknown): void => {
	log.error('Необработанное отклонение промиса', { reason });
};

const handleShutdownSignal = (signal: string): void => {
	log.info(`Получен сигнал завершения: ${signal}`);
	gracefulShutdown();
};

const gracefulShutdown = async (): Promise<void> => {
	if (APP_CONFIG.isShuttingDown) {
		log.warn('Graceful shutdown уже выполняется');
		return;
	}

	APP_CONFIG.isShuttingDown = true;
	log.info('Начинается graceful shutdown...');

	try {
		stopBot();
		await new Promise((resolve) => setTimeout(resolve, APP_CONFIG.GRACEFUL_SHUTDOWN_TIMEOUT));
		log.info('Приложение завершено корректно');
		process.exit(0);
	} catch (error) {
		log.error('Ошибка при graceful shutdown', { error });
		process.exit(1);
	}
};

const setupGlobalErrorHandlers = (): void => {
	process.on('uncaughtException', handleUncaughtException);
	process.on('unhandledRejection', handleUnhandledRejection);
	process.on('SIGINT', () => handleShutdownSignal('SIGINT'));
	process.on('SIGTERM', () => handleShutdownSignal('SIGTERM'));
	process.on('SIGUSR2', () => handleShutdownSignal('SIGUSR2'));
	process.on('exit', (code) => {
		log.info(`Процесс завершен с кодом: ${code}`);
	});

	log.info('Глобальные обработчики ошибок настроены');
};

const startApplication = (): void => {
	try {
		log.info('Запуск Telegram OCR Bot...');

		setupGlobalErrorHandlers();
		setupDefaultDirectories();
		initializeBot();

		log.info('Приложение запущено и готово к работе');
	} catch (error) {
		log.error('Критическая ошибка при запуске', { error });
		process.exit(1);
	}
};

startApplication();
