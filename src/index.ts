import { initializeBot, stopBot } from './services/telegram/botLifecycle';
import { createScopedLogger } from './services/logger';
import { setupDefaultDirectories } from './utils/directories';

const log = createScopedLogger('index');

const APP_CONFIG = {
	GRACEFUL_SHUTDOWN_TIMEOUT: 1000,
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
		await stopBot();
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
	process.on('exit', (code) => {
		log.info(`Процесс завершен с кодом: ${code}`);
	});

	log.info('Глобальные обработчики ошибок настроены');
};

const startApplication = async (): Promise<void> => {
	try {
		log.info('Запуск Telegram OCR Bot...');

		setupGlobalErrorHandlers();
		setupDefaultDirectories();
		await initializeBot();

		log.info('Приложение запущено и готово к работе');
	} catch (error) {
		log.error('Критическая ошибка при запуске', { error });
		process.exit(1);
	}
};

void startApplication();
