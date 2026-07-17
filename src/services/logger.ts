/**
 * Модуль логирования: запись в файлы (app.log / error.log), консоль с цветами, ротация старых логов.
 * Используй createScopedLogger('moduleName') для логов с префиксом модуля.
 */
import fs from 'fs';
import path from 'path';
import util from 'util';

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
	private static readonly COLORS = {
		info: '\x1b[32m',
		warn: '\x1b[33m',
		error: '\x1b[31m',
		debug: '\x1b[90m',
		reset: '\x1b[0m',
	} as const;

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
		const timestamp = this.formatTimestamp(new Date());
		const logEntry: LogEntry = {
			timestamp,
			level,
			scope: this.scope,
			message,
			data,
		};
		const logString = this.formatFileLog(logEntry);

		try {
			const filePath = path.join(this.logsDir, level === 'error' ? 'error.log' : 'app.log');
			fs.appendFileSync(filePath, logString);
		} catch (error) {
			console.error('[logger] Ошибка записи в лог-файл:', error);
		}

		const scopeLabel = this.scope ? `[${this.scope}] ` : '';
		const prefix = `[${timestamp}] ${level.toUpperCase()} ${scopeLabel}${message}`;
		const color = Logger.COLORS[level];

		if (data === undefined) {
			console.log(`${color}${prefix}${Logger.COLORS.reset}`);
			return;
		}

		console.log(`${color}${prefix}${Logger.COLORS.reset}\n${this.formatConsoleData(data)}`);
	}

	private formatTimestamp(date: Date): string {
		return new Intl.DateTimeFormat('ru-RU', {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hour12: false,
		}).format(date);
	}

	private formatFileLog(entry: LogEntry): string {
		const scopeLabel = entry.scope ? `[${entry.scope}] ` : '';
		const baseLine = `[${entry.timestamp}] ${entry.level.toUpperCase()} ${scopeLabel}${entry.message}`;

		if (entry.data === undefined) {
			return `${baseLine}\n`;
		}

		return `${baseLine}\n${this.formatFileData(entry.data)}\n`;
	}

	private formatFileData(data: unknown): string {
		if (data instanceof Error) {
			return data.stack || data.message;
		}

		if (typeof data === 'string') {
			return data;
		}

		return util.inspect(data, {
			depth: 6,
			colors: false,
			compact: false,
			breakLength: 120,
		});
	}

	private formatConsoleData(data: unknown): string {
		if (data instanceof Error) {
			return data.stack || data.message;
		}

		if (typeof data === 'string') {
			return data;
		}

		return util.inspect(data, {
			depth: 6,
			colors: true,
			compact: false,
			breakLength: 120,
		});
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
