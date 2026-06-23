import TelegramBot from 'node-telegram-bot-api';
import { MESSAGES } from '../variables/messages';
import { createScopedLogger } from './logger';
import { processDocumentWithFlexibleExtraction } from './claudeService';
import path from 'path';
import { downloadFile, downloadFileToBuffer, normalizeFileName, deleteFileIfExists } from '../utils/files';
import { config } from '../config';
import { ensureDirectoryExists } from '../utils/directories';
import { createExcelFileFromData } from '../utils/createExcelFile';
import fs from 'fs';
import { ProcessingResult, ParsedDocument, FileType, ProcessingStatus, FilePaths, ProcessingContext } from '../types/types';

const log = createScopedLogger('botHandlers');

const EXCEL_EXTENSIONS = ['.xls', '.xlsx', '.csv'] as const;

/**
 * Обрабатывает команду /start
 * Отправляет приветственное сообщение пользователю
 * @param bot - Экземпляр Telegram бота
 * @param msg - Сообщение от пользователя
 */
export const handleStart = async (bot: TelegramBot, msg: TelegramBot.Message): Promise<void> => {
	const chatId = msg.chat.id;

	try {
		log.info(`Начало работы с пользователем: ${chatId}`);
		await bot.sendMessage(chatId, MESSAGES.START_MESSAGE);
	} catch (error) {
		log.error('Ошибка обработки команды /start', { error, chatId });
	}
};

/**
 * Обрабатывает команду /help
 * Отправляет справочное сообщение пользователю
 * @param bot - Экземпляр Telegram бота
 * @param msg - Сообщение от пользователя
 */
export const handleHelp = async (bot: TelegramBot, msg: TelegramBot.Message): Promise<void> => {
	const chatId = msg.chat.id;

	try {
		await bot.sendMessage(chatId, MESSAGES.HELP_MESSAGE);
	} catch (error) {
		log.error('Ошибка обработки команды /help', { error, chatId });
	}
};

/**
 * Обрабатывает входящие документы
 */
export const handleDocument = async (bot: TelegramBot, msg: TelegramBot.Message): Promise<void> => {
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
 * Обрабатывает входящие фотографии
 */
export const handlePhoto = async (bot: TelegramBot, msg: TelegramBot.Message): Promise<void> => {
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

/**
 * Универсальная функция обработки файлов (документы и фото)
 * Координирует весь процесс обработки от получения файла до отправки результата
 * @param bot - Экземпляр Telegram бота
 * @param msg - Сообщение с файлом от пользователя
 * @param fileType - Тип файла ('document' или 'photo')
 * @param fileName - Имя файла для обработки
 */
const processFile = async (bot: TelegramBot, msg: TelegramBot.Message, fileType: FileType, fileName: string): Promise<void> => {
	const chatId = msg.chat.id;

	log.info('Начало обработки файла', { chatId, fileType, fileName });

	try {
		const fileInfo = await getFileInfo(bot, msg, fileType, fileName);

		const statusMessage = await sendInitialStatus(bot, chatId, fileType);
		const context: ProcessingContext = { chatId, fileType, fileName, statusMessage };

		await updateProcessingStatus(bot, context, 'downloading');
		const fileBuffer = await downloadFileContent(fileInfo);

		await updateProcessingStatus(bot, context, 'analyzing');
		const result = await processDocumentWithFlexibleExtraction(fileInfo.localPath, fileInfo.telegramPath, fileBuffer);
		log.info('Анализ завершен', { chatId, fileType, fileName });

		await updateProcessingStatus(bot, context, 'completed');
		await sendProcessingResult(bot, chatId, result, fileName);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
		const errorText = fileType === 'document' ? MESSAGES.ERROR_PROCESSING_DOCUMENT : MESSAGES.ERROR_PROCESSING_PHOTO;
		await bot.sendMessage(chatId, errorText);
		log.error(`Ошибка обработки ${fileType}`, { error, chatId, errorMessage });
	} finally {
		const localPath = path.join(config.paths.uploads, fileName);
		deleteFileIfExists(localPath);
	}
};

/**
 * Получает информацию о файле из Telegram API
 * @param bot - Экземпляр Telegram бота
 * @param msg - Сообщение с файлом
 * @param fileType - Тип файла
 * @param fileName - Имя файла
 * @returns Информация о файле для дальнейшей обработки
 */
const getFileInfo = async (
	bot: TelegramBot,
	msg: TelegramBot.Message,
	fileType: FileType,
	fileName: string,
): Promise<{
	fileId: string;
	telegramPath: string;
	localPath: string;
	extension: string;
	isExcel: boolean;
}> => {
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
	const isExcel = EXCEL_EXTENSIONS.includes(extension as any);

	log.info(`Получена информация о файле: ${fileType}, расширение: ${extension}, Excel: ${isExcel}`);

	return { fileId, telegramPath: file.file_path, localPath, extension, isExcel };
};

/**
 * Скачивает содержимое файла с Telegram серверов
 * @param fileInfo - Информация о файле
 * @returns Buffer с данными файла или undefined для Excel файлов
 */
const downloadFileContent = async (fileInfo: { telegramPath: string; localPath: string; isExcel: boolean }): Promise<Buffer | undefined> => {
	if (fileInfo.isExcel) {
		await downloadFile(fileInfo.telegramPath, fileInfo.localPath);
		return undefined;
	} else {
		const buffer = await downloadFileToBuffer(fileInfo.telegramPath);
		log.info(`Файл скачан в память, размер: ${buffer.length} байт`);
		return buffer;
	}
};

/**
 * Отправляет начальный статус обработки файла
 * @param bot - Экземпляр Telegram бота
 * @param chatId - ID чата пользователя
 * @param fileType - Тип файла
 * @returns Promise с сообщением статуса
 */
const sendInitialStatus = async (bot: TelegramBot, chatId: number, fileType: FileType): Promise<TelegramBot.Message> => {
	const statusText = fileType === 'document' ? MESSAGES.STATUS_DOCUMENT_RECEIVED : MESSAGES.STATUS_PHOTO_RECEIVED;
	return await bot.sendMessage(chatId, statusText);
};

/**
 * Обновляет статус обработки файла в Telegram чате
 * @param bot - Экземпляр Telegram бота
 * @param context - Контекст обработки
 * @param status - Новый статус обработки
 */
const updateProcessingStatus = async (bot: TelegramBot, context: ProcessingContext, status: ProcessingStatus): Promise<void> => {
	const statusMessages = {
		downloading: context.fileType === 'document' ? MESSAGES.STATUS_DOWNLOADING_DOCUMENT : MESSAGES.STATUS_DOWNLOADING_PHOTO,
		analyzing: context.fileType === 'document' ? MESSAGES.STATUS_ANALYZING_DOCUMENT : MESSAGES.STATUS_ANALYZING_PHOTO,
		completed: MESSAGES.STATUS_PROCESSING_COMPLETED,
	};

	await bot.editMessageText(statusMessages[status], {
		chat_id: context.chatId,
		message_id: context.statusMessage.message_id,
	});
};

/**
 * Формирует имя файла на основе данных документа
 * @param data - Разобранные данные документа
 * @param originalFileName - Исходное имя файла
 * @returns Сформированное имя файла
 */
const generateFileName = (data: ParsedDocument, originalFileName: string): string => {
	const invoiceNumber = data.invoice_number ? normalizeFileName(`№ ${data.invoice_number}`) : '';
	const invoiceDate = data.invoice_date ? normalizeFileName(` від ${data.invoice_date}`) : '';
	const supplier = data.supplier ? normalizeFileName(data.supplier) : 'unknown';

	const originalBaseName = path.parse(originalFileName).name;
	const timestamp = Date.now();

	let baseName = '';
	if (invoiceNumber) {
		baseName = `${invoiceNumber}${invoiceDate}_${supplier}_${timestamp}`;
	} else {
		baseName = `${normalizeFileName(originalBaseName)}_${supplier}_${timestamp}`;
	}

	return normalizeFileName(baseName);
};

/**
 * Сохраняет файлы (JSON и Excel) и возвращает их пути
 * @param data - Разобранные данные документа
 * @param baseName - Базовое имя файла
 * @returns Пути к сохраненным файлам
 */
const saveResultFiles = (data: ParsedDocument, baseName: string): FilePaths => {
	ensureDirectoryExists(config.paths.uploads);

	const jsonFileName = `${baseName}.json`;
	const xlsxFileName = `${baseName}.xlsx`;
	const jsonFilePath = path.join(config.paths.uploads, jsonFileName);
	const xlsxFilePath = path.join(config.paths.uploads, xlsxFileName);

	fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2));
	createExcelFileFromData(data, xlsxFilePath);

	log.info('Временные файлы результата созданы', { jsonFilePath, xlsxFilePath });

	return { jsonPath: jsonFilePath, xlsxPath: xlsxFilePath };
};

/**
 * Отправляет результат обработки пользователю
 * @param bot - Экземпляр Telegram бота
 * @param chatId - ID чата пользователя
 * @param data - Разобранные данные документа
 * @param filePaths - Пути к файлам для отправки
 */
const sendResultToUser = async (bot: TelegramBot, chatId: number, data: ParsedDocument, filePaths: Pick<FilePaths, 'jsonPath' | 'xlsxPath'>): Promise<void> => {
	// Отправляем сообщение с результатом
	const messageSummary =
		`${MESSAGES.SUCCESS_DOCUMENT_PROCESSED}\n\n` +
		`${MESSAGES.SUCCESS_SUPPLIER} ${data.supplier || 'Не указан'}\n` +
		`${MESSAGES.SUCCESS_DATE} ${data.invoice_date || 'Не указана'}\n` +
		`${MESSAGES.SUCCESS_ITEMS_COUNT} ${data.items?.length || 0}` +
		`\n\n${MESSAGES.SUCCESS_DETAILS}`;

	await bot.sendMessage(chatId, messageSummary);

	// Отправляем JSON файл
	await bot.sendDocument(chatId, filePaths.jsonPath, {
		caption: MESSAGES.CAPTION_JSON_FILE,
	});

	// Отправляем Excel файл
	await bot.sendDocument(chatId, filePaths.xlsxPath, {
		caption: MESSAGES.CAPTION_EXCEL_FILE,
	});
};

/**
 * Очищает временные файлы после обработки
 * @param filePaths - Пути к файлам для удаления
 */
const cleanupTempFiles = (filePaths: FilePaths): void => {
	deleteFileIfExists(filePaths.jsonPath);
	deleteFileIfExists(filePaths.xlsxPath);
	log.debug('Временные файлы результата удалены', filePaths);
};

/**
 * Обрабатывает и отправляет результат обработки документа пользователю
 * @param bot - Экземпляр Telegram бота
 * @param chatId - ID чата пользователя
 * @param result - Результат обработки документа
 * @param originalFileName - Исходное имя файла
 */
const sendProcessingResult = async (bot: TelegramBot, chatId: number, result: ProcessingResult, originalFileName: string): Promise<void> => {
	if (result.success && result.data) {
		try {
			// Генерируем имя файла
			const baseName = generateFileName(result.data, originalFileName);

			// Сохраняем файлы
			const filePaths = saveResultFiles(result.data, baseName);

			// Отправляем результат пользователю
			await sendResultToUser(bot, chatId, result.data, filePaths);

			// Очищаем временные файлы
			cleanupTempFiles(filePaths);

			log.info(`Документ успешно обработан для чата ${chatId}`);
		} catch (error) {
			log.error('Ошибка при отправке результата пользователю', { error, chatId });
			await bot.sendMessage(chatId, MESSAGES.ERROR_RESULT_FORMATION);
		}
	} else {
		const errorMessage = `❌ Ошибка: ${result.error || 'Произошла неизвестная ошибка'}`;
		await bot.sendMessage(chatId, errorMessage);
		log.error(`Ошибка обработки документа для чата ${chatId}`, { error: result.error });
	}
};
