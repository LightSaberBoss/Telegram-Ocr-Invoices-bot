/**
 * PID lock-файл: гарантирует запуск только одного экземпляра бота на машине.
 * При падении процесса устаревший lock автоматически удаляется.
 */
import fs from 'fs';
import path from 'path';
import { createScopedLogger } from '../logger';

const log = createScopedLogger('telegram/botLock');

export const BOT_LOCK_FILE_PATH = path.resolve(process.cwd(), '.telegram-bot.lock');

let lockFileDescriptor: number | null = null;

/**
 * Проверяет, существует ли процесс с указанным PID.
 * @param pid Идентификатор процесса из lock-файла
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
 * Читает PID из lock-файла.
 * @returns PID или null, если файл отсутствует или повреждён
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
 * Захватывает lock на запуск polling (один процесс на один бот).
 * @throws Error если другой экземпляр бота уже запущен
 */
export const acquireBotLock = (): void => {
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
 * Освобождает lock запуска бота (закрывает дескриптор и удаляет файл).
 */
export const releaseBotLock = (): void => {
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

/** Регистрирует освобождение lock при завершении процесса */
export const registerLockCleanupOnExit = (): void => {
	process.on('exit', () => {
		releaseBotLock();
	});
};
