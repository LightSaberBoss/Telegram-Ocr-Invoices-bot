import fs from 'fs';
import path from 'path';

export type LogLevel = 'info' | 'error' | 'warn' | 'debug';

export interface LogEntry {
	timestamp: string;
	level: LogLevel;
	scope?: string;
	message: string;
	data?: unknown;
}

export interface ScopedLogger {
	info: (message: string, data?: unknown) => void;
	error: (message: string, data?: unknown) => void;
	warn: (message: string, data?: unknown) => void;
	debug: (message: string, data?: unknown) => void;
}

/**
 * Класс для логирования с автоматической ротацией и очисткой старых логов
 */
export class Logger {
	private logsDir: string;
	private maxLogAge: number;
	private scope?: string;

	constructor(logsDir: string = path.resolve(__dirname, '../../logs'), maxLogAge: number = 7 * 24 * 60 * 60 * 1000, scope?: string) {
		this.logsDir = logsDir;
		this.maxLogAge = maxLogAge;
		this.scope = scope;

		if (!scope) {
			this.ensureLogsDirectory();
			this.cleanupOldLogs();
		}
	}

	private ensureLogsDirectory(): void {
		if (!fs.existsSync(this.logsDir)) {
			fs.mkdirSync(this.logsDir, { recursive: true });
		}
	}

	private cleanupOldLogs(): void {
		try {
			const files = fs.readdirSync(this.logsDir);
			const now = Date.now();

			files.forEach((file) => {
				const filePath = path.join(this.logsDir, file);
				const stats = fs.statSync(filePath);
				if (now - stats.mtimeMs > this.maxLogAge) {
					fs.unlinkSync(filePath);
				}
			});
		} catch (error) {
			console.error('[logger] Ошибка при очистке старых логов:', error);
		}
	}

	private write(level: LogLevel, message: string, data?: unknown): void {
		const timestamp = new Date().toISOString();
		const logEntry: LogEntry = {
			timestamp,
			level,
			scope: this.scope,
			message,
			data,
		};
		const logString = JSON.stringify(logEntry) + '\n';

		try {
			const filePath = path.join(this.logsDir, level === 'error' ? 'error.log' : 'app.log');
			fs.appendFileSync(filePath, logString);
		} catch (error) {
			console.error('[logger] Ошибка записи в лог-файл:', error);
		}

		const scopeLabel = this.scope ? `[${this.scope}] ` : '';
		const prefix = `[${timestamp}] ${level.toUpperCase()} ${scopeLabel}`;

		if (data !== undefined) {
			console.log(`${prefix}${message}`, data);
			return;
		}

		console.log(`${prefix}${message}`);
	}

	info(message: string, data?: unknown): void {
		this.write('info', message, data);
	}

	error(message: string, data?: unknown): void {
		this.write('error', message, data);
	}

	warn(message: string, data?: unknown): void {
		this.write('warn', message, data);
	}

	debug(message: string, data?: unknown): void {
		this.write('debug', message, data);
	}
}

/** Глобальный экземпляр логгера (без scope) */
export const logger = new Logger();

/**
 * Создает логгер с префиксом модуля, например: [telegramBot]
 */
export const createScopedLogger = (scope: string): ScopedLogger => {
	const scopedLogger = new Logger(path.resolve(__dirname, '../../logs'), 7 * 24 * 60 * 60 * 1000, scope);

	return {
		info: (message, data) => scopedLogger.info(message, data),
		error: (message, data) => scopedLogger.error(message, data),
		warn: (message, data) => scopedLogger.warn(message, data),
		debug: (message, data) => scopedLogger.debug(message, data),
	};
};
