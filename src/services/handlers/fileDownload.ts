/**
 * Получение метаданных файла из Telegram и скачивание содержимого.
 */
import path from 'path';
import type TelegramBot from 'node-telegram-bot-api';
import type { Message } from 'node-telegram-bot-api';
import { MESSAGES } from '../../variables/messages';
import { config } from '../../config';
import { FileType } from '../../types/types';
import { downloadFile, downloadFileToBuffer } from '../../utils/files';
import { createScopedLogger } from '../logger';

const log = createScopedLogger('handlers/fileDownload');

const EXCEL_EXTENSIONS = ['.xls', '.xlsx', '.csv'] as const;

export interface FileInfo {
	fileId: string;
	telegramPath: string;
	localPath: string;
	extension: string;
	isExcel: boolean;
}

/**
 * Запрашивает у Telegram API информацию о файле и формирует пути для обработки.
 * @param bot Экземпляр Telegram бота
 * @param msg Сообщение с файлом
 * @param fileType Тип файла (document или photo)
 * @param fileName Имя файла для локального сохранения
 */
export const getFileInfo = async (bot: TelegramBot, msg: Message, fileType: FileType, fileName: string): Promise<FileInfo> => {
	let fileId: string;

	if (fileType === 'document') {
		fileId = msg.document!.file_id;
	} else {
		fileId = msg.photo![msg.photo!.length - 1].file_id;
	}

	const file = await bot.getFile(fileId);
	if (!file.file_path) {
		throw new Error(MESSAGES.ERROR_FILE_PATH_NOT_FOUND);
	}

	const localPath = path.join(config.paths.uploads, fileName);
	const extension = path.extname(localPath).toLowerCase();
	const isExcel = EXCEL_EXTENSIONS.includes(extension as (typeof EXCEL_EXTENSIONS)[number]);

	log.info(`Получена информация о файле: ${fileType}, расширение: ${extension}, Excel: ${isExcel}`);

	return { fileId, telegramPath: file.file_path, localPath, extension, isExcel };
};

/**
 * Скачивает файл с серверов Telegram.
 * Excel сохраняется на диск; остальные форматы — в Buffer в памяти.
 * @param fileInfo Метаданные файла из getFileInfo
 * @returns Buffer с данными или undefined для Excel (файл на диске)
 */
export const downloadFileContent = async (fileInfo: Pick<FileInfo, 'telegramPath' | 'localPath' | 'isExcel'>): Promise<Buffer | undefined> => {
	if (fileInfo.isExcel) {
		await downloadFile(fileInfo.telegramPath, fileInfo.localPath);
		return undefined;
	}

	const buffer = await downloadFileToBuffer(fileInfo.telegramPath);
	log.info(`Файл скачан в память, размер: ${buffer.length} байт`);
	return buffer;
};
