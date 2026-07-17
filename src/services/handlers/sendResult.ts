/**
 * Формирование, сохранение и отправка результата распознавания пользователю.
 */
import fs from 'fs';
import path from 'path';
import type TelegramBot from 'node-telegram-bot-api';
import { MESSAGES } from '../../variables/messages';
import { config } from '../../config';
import { ParsedDocument, ProcessingResult, FilePaths } from '../../types/types';
import { normalizeFileName, deleteFileIfExists } from '../../utils/files';
import { ensureDirectoryExists } from '../../utils/directories';
import { createExcelFileFromData } from '../../utils/createExcelFile';
import { createScopedLogger } from '../logger';

const log = createScopedLogger('handlers/sendResult');

/**
 * Формирует имя выходного файла на основе данных счёта и поставщика.
 * @param data Распознанные данные документа
 * @param originalFileName Исходное имя файла от пользователя
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
 * Сохраняет JSON и Excel во временную папку uploads.
 * @param data Распознанные данные
 * @param baseName Базовое имя файла без расширения
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
 * Отправляет пользователю сводку и файлы JSON + Excel.
 * @param bot Экземпляр Telegram бота
 * @param chatId ID чата
 * @param data Распознанные данные
 * @param filePaths Пути к JSON и XLSX
 */
const sendResultToUser = async (
	bot: TelegramBot,
	chatId: number,
	data: ParsedDocument,
	filePaths: Pick<FilePaths, 'jsonPath' | 'xlsxPath'>,
): Promise<void> => {
	const messageSummary =
		`${MESSAGES.SUCCESS_DOCUMENT_PROCESSED}\n\n` +
		`${MESSAGES.SUCCESS_SUPPLIER} ${data.supplier || 'Не указан'}\n` +
		`${MESSAGES.SUCCESS_DATE} ${data.invoice_date || 'Не указана'}\n` +
		`${MESSAGES.SUCCESS_ITEMS_COUNT} ${data.items?.length || 0}` +
		`\n\n${MESSAGES.SUCCESS_DETAILS}`;

	await bot.sendMessage(chatId, messageSummary);
	await bot.sendDocument(chatId, filePaths.jsonPath, { caption: MESSAGES.CAPTION_JSON_FILE });
	await bot.sendDocument(chatId, filePaths.xlsxPath, { caption: MESSAGES.CAPTION_EXCEL_FILE });
};

/**
 * Удаляет временные файлы результата из uploads.
 * @param filePaths Пути к JSON и XLSX
 */
const cleanupTempFiles = (filePaths: FilePaths): void => {
	deleteFileIfExists(filePaths.jsonPath);
	deleteFileIfExists(filePaths.xlsxPath);
	log.debug('Временные файлы результата удалены', filePaths);
};

/**
 * Обрабатывает результат распознавания: сохраняет файлы, отправляет пользователю, очищает временные данные.
 * @param bot Экземпляр Telegram бота
 * @param chatId ID чата
 * @param result Результат от Claude API
 * @param originalFileName Исходное имя файла
 */
export const sendProcessingResult = async (
	bot: TelegramBot,
	chatId: number,
	result: ProcessingResult,
	originalFileName: string,
): Promise<void> => {
	if (result.success && result.data) {
		try {
			const baseName = generateFileName(result.data, originalFileName);
			const filePaths = saveResultFiles(result.data, baseName);

			const externalJsonPath = path.join(config.paths.files, `${baseName}.json`);
			ensureDirectoryExists(config.paths.files);
			fs.writeFileSync(externalJsonPath, JSON.stringify(result.data, null, 2));
			log.info('JSON сохранен во внешнюю директорию files', { externalJsonPath });

			await sendResultToUser(bot, chatId, result.data, filePaths);
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
