import fs from 'fs';
import path from 'path';
import { ParsedDocument, ProcessingResult } from '../types/types';
import { config } from '../config';
import { createScopedLogger } from './logger';
import Anthropic from '@anthropic-ai/sdk';
import * as XLSX from 'xlsx';
import pdfParse from 'pdf-parse';
import sharp from 'sharp';

const log = createScopedLogger('claudeService');

// Инициализация клиента Anthropic
const anthropic = new Anthropic({
	apiKey: config.claude.apiKey,
});

// Глобальная переменная для отслеживания числа активных запросов
let activeRequests = 0;

// Конфигурация для повторных попыток
const RETRY_CONFIG = {
	MAX_RETRIES: 3,
	INITIAL_DELAY: 5000, // 5 секунд
	DELAY_MULTIPLIER: 2,
} as const;

// Базовый промт для обработки документов
const BASE_PROMPT = `
Пожалуйста, прочитай текст ниже. Он может содержать несколько языков (укр, рус, англ), в документе может быть пометка о наличии цены с ПДВ (НДС) или без. Определи в нём следующие данные:

Документ может быть в формате PDF с несколькими страницами. Разделители страниц могут выглядеть так: "=== Страница N ===".
Ищи важную информацию по всему тексту. Счет и таблица могут быть на разных страницах.
Так же это может быть фотография или скриншот счета.
А так же это может быть табллица excel в формате xls или xlsx.
ОБРАТИ ВНИМАНИЕ! Документ может содержать таблицы в формате JSON (обозначены как "--- Таблицы на странице N ---"). 
Если видишь таблицы в JSON формате, используй их для более точного извлечения данных о товарах.

При анализе документа обрати НАИБОЛЕЕ КРИТИЧНОЕ внимание на идентификационные коды:

1. ЕДРПОУ/ЄДРПОУ:
   - СТРОГО ищи в формате "код за ЄДРПОУ XXXXXXXX" или "ЄДРПОУ: XXXXXXXX" или "Код ЄДРПОУ XXXXXXXX"
   - Это обычно 8 цифр, но для ФЛП (ФОП) может быть 10 цифр
   - Расположен в шапке документа или реквизитах поставщика
   - НЕ ПУТАЙ с р/с, МФО или другими числовыми идентификаторами!
   - НИКОГДА не бери цифры из банковского счета (строки, содержащей "UA" или "р/с")!
   - Пример: "код за ЄДРПОУ 35601501" или "Код ЄДРПОУ 2103005940"

2. ИНН/ІПН:
   - СТРОГО ищи в формате "ІПН XXXXXXXXXXXX" или "ИНН: XXXXXXXXXXXX"
   - Это ВСЕГДА 10-12 цифр (не меньше и не больше)
   - Обычно идет сразу после ЕДРПОУ в том же блоке текста
   - Пример: "ІПН 356015004822"

ВАЖНО! При анализе номера счета или счета-фактуры:
- Обрати внимание на буквенные префиксы, например "Л-25/46" или "Л-25/46"
- Сохраняй исходный формат разделителей: тире (-), дробь (/) и т.д.
- В украинских документах: "Рахунок-фактура № Л-25/46" - номер "Л-25/46"

НИКОГДА не используй номер свидетельства или другие числа для ЕДРПОУ и ИНН!
Если видишь строку "код за ЄДРПОУ 35601501, ІПН 356015004822, № свід. 200026344", то:
- ЕДРПОУ = 35601501 (8 цифр после "код за ЄДРПОУ")
- ИНН = 356015004822 (после "ІПН")
- НЕ используй "200026344" (номер свидетельства) в качестве ЕДРПОУ или ИНН!

НИКОГДА не используй числа из номера расчетного счета, МФО или других реквизитов вместо ЕДРПОУ и ИНН!
Если не можешь точно определить эти коды, верни пустую строку вместо предположений.
НЕ МЕНЯЙ ПОРЯДОК ЦИФР! Копируй цифры ТОЧНО в том порядке, как они указаны в документе!

ЕДРПОУ должен быть 8-значным числом, расположенным сразу после слов "код за ЄДРПОУ" или "ЄДРПОУ". 
НЕ путай ЕДРПОУ с другими числами в документе, особенно с расчетным счетом!
Если видишь формат "код за ЄДРПОУ XXXXXXXX", обязательно извлеки все 8 цифр, а не их часть.

Тебе не надо дополнительно менять цены и считать их, только считывать и думать куда их переносить в правильные поля.

ОЧЕНЬ ВАЖНО! При определении поля isPriceWithPdv (указаны ли цены с ПДВ/НДС):
1. Если в таблице есть колонка "Цiна з ПДВ", "Сума з ПДВ" или подобные - значит цены указаны с ПДВ
2. Если рядом с ценой есть пометка "в т.ч. ПДВ" - значит цены указаны с ПДВ
3. Если в документе ниже есть строка "У тому числi ПДВ" с суммой - скорее всего цены указаны с ПДВ
4. Если вообще нет упоминания ПДВ/НДС - считай, что цены без ПДВ

ОБЯЗАТЕЛЬНО! Если цены указаны и с ПДВ и без, то надо заполнить все поля ..._no_pdv и ..._with_pdv.

invoice_number — номер (№) счета. /1234/
invoice_date — дата счета. /DD.MM.YYYY/
edrpou — едрпоу поставщика. /1234567890/
ipn — ипн поставщика. /1234567890/
supplier — название поставщика (контрагента). /ООО 'Стройматериалы'/
isPriceWithPdv — какая цена указана в items с ПДВ (НДС) или без. /true/false/
total_no_pdv — общая сумма без ПДВ. /10000/
total_pdv — общая сумма ПДВ. /1000/
total_with_pdv — общая сумма c ПДВ. /11000/

items — список позиций (товаров, услуг или работ), где у каждой позиции нужно указать:
name — наименование, /Кирпич/
article — артикул, /1234567890 || КР 2.04 || ZST10230-04079/ (может использовать буквы нескольких языков)
quantity — количество (числовое значение), /1000/
unit — единица измерения. Может быть указана отдельно или вместе с количеством (например, "шт","шт.", "100шт", "кг", "м", "м²", "м³", "л","од","од.",). Возможно, единица измерения указана вместе с числом (например, "100шт"), то это число является unit, а не количеством, надо продумать и указать корректно количество и единицу измерения!

При распознавании единиц измерения обрати внимание на следующие специфические единицы:
- "год" (украинское "години" - часы)
- "м3", "м²", "м" (кубические метры, квадратные метры, метры)

price_no_pdv — цена без ПДВ (числовое значение), /100/
price_with_pdv — цена с ПДВ (числовое значение), /110/
total_no_pdv — итоговая сумма без ПДВ. /10000/
total_with_pdv — итоговая сумма с ПДВ. /11000/

ОБЯЗАТЕЛЬНО! Все количества, цены и суммы должны быть числовыми значениями!
ОБЯЗАТЕЛЬНО! Возможно, единица измерения указана вместе с числом (например, "100шт"), то это число является unit, а не количеством, надо продумать и указать корректно количество и единицу измерения!

Если какой-то информации не хватает, укажи null.

Ответ ДОЛЖЕН быть только в виде корректного JSON без лишних символов, комментариев и текста вне фигурных скобок.

Вот пример ожидаемого формата ответа:
{
	"invoice_number": "1234567890",
	"invoice_date": "01.01.2021",
	"edrpou": "1234567890",
	"ipn": "1234567890",
	"supplier": "ООО 'Стройматериалы'",
	"isPriceWithPdv": true | false,
	"items": [
		{
			"name": "Кирпич" | "Кирпич 2.04" | "Кирпич 2.04 079" | null,
			"article": "1234567890" | "КР 2.04" | "ZST10230-04079" | null,
			"quantity": 20 | null,  // количество товара
			"unit": "100шт" | "шт" ..., // размер единицы измерения (100 штук в упаковке)
			"price_no_pdv": 100 | null,
			"price_with_pdv": 110 | null,
			"total_no_pdv": 10000 | null,
			"total_with_pdv": 11000 | null
		},
		{
			"name": "Песок",
			"article": null,
			"quantity": 5,
			"unit": "м³",          // обычная единица измерения
			"price_no_pdv": 200,
			"price_with_pdv": 220,
			"total_no_pdv": 1000,
			"total_with_pdv": 1100
		}
	],
	"total_no_pdv": 10000 | null,
	"total_pdv": 1000 | null,
	"total_with_pdv": 11000 | null
}
`;

/**
 * Преобразует изображение в формат и размер, подходящий для отправки в API Claude
 * Claude может принимать изображения размером до 5MB
 * @param input Путь к файлу изображения или Buffer с данными изображения
 * @returns Buffer с оптимизированным изображением
 */
async function prepareImageForClaude(input: string | Buffer): Promise<Buffer> {
	try {
		let image: sharp.Sharp;

		if (Buffer.isBuffer(input)) {
			// Работаем напрямую с Buffer из памяти
			image = sharp(input);
			log.info('prepareImageForClaude: Обработка изображения из памяти (Buffer)');
		} else {
			// Работаем с файлом на диске
			image = sharp(input);
			log.info(`prepareImageForClaude: Обработка изображения из файла: ${input}`);
		}

		const metadata = await image.metadata();

		// Если изображение слишком большое, уменьшаем его
		if ((metadata.width && metadata.width > 1500) || (metadata.height && metadata.height > 1500)) {
			return await image.resize(1500, 1500, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
		}

		// Иначе просто оптимизируем формат и качество
		return await image.jpeg({ quality: 85 }).toBuffer();
	} catch (error) {
		log.error('Ошибка подготовки изображения', { error, inputType: Buffer.isBuffer(input) ? 'Buffer' : 'file' });

		// Если что-то пошло не так, возвращаем исходные данные
		if (Buffer.isBuffer(input)) {
			return input; // Возвращаем исходный Buffer
		} else {
			return fs.readFileSync(input); // Возвращаем содержимое файла
		}
	}
}

/**
 * Извлекает текст из PDF файла или Buffer
 * @param input Путь к PDF файлу или Buffer с PDF данными
 * @returns Извлеченный текст и метаданные
 */
async function extractTextFromPdf(input: string | Buffer): Promise<{ text: string; pageCount: number }> {
	try {
		let dataBuffer: Buffer;

		if (Buffer.isBuffer(input)) {
			// Работаем напрямую с Buffer
			dataBuffer = input;
			log.info('extractTextFromPdf: Обработка PDF из памяти (Buffer)');
		} else {
			// Читаем файл с диска
			dataBuffer = fs.readFileSync(input);
			log.info(`extractTextFromPdf: Обработка PDF из файла: ${input}`);
		}

		const pdfData = await pdfParse(dataBuffer);

		return {
			text: pdfData.text,
			pageCount: pdfData.numpages,
		};
	} catch (error) {
		log.error('Ошибка извлечения текста из PDF', { error, inputType: Buffer.isBuffer(input) ? 'Buffer' : 'file' });
		throw new Error('Не удалось извлечь текст из PDF');
	}
}

/**
 * Извлекает текст из файла Excel
 * @param filePath Путь к файлу Excel
 * @returns Извлеченный текст в виде строки
 */
async function extractTextFromExcel(filePath: string): Promise<string> {
	try {
		// Загружаем книгу Excel
		const workbook = XLSX.readFile(filePath);

		let extractedText = '';

		// Обрабатываем каждый лист
		for (const sheetName of workbook.SheetNames) {
			const worksheet = workbook.Sheets[sheetName];

			// Добавляем имя листа
			extractedText += `=== Лист: ${sheetName} ===\n`;

			// Конвертируем лист в JSON
			const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

			// Преобразуем данные в текст
			for (const row of jsonData) {
				if (Array.isArray(row) && row.length > 0) {
					extractedText += row.map((cell) => (cell !== undefined && cell !== null ? cell.toString() : '')).join('\t') + '\n';
				}
			}

			extractedText += '\n';
		}

		return extractedText;
	} catch (error) {
		log.error('Ошибка извлечения текста из Excel', { error, filePath });
		throw new Error('Не удалось извлечь текст из Excel');
	}
}

/**
 * Функция для определения типа файла и его обработки перед отправкой в Claude API
 * @param filePath Путь к файлу
 * @param fileBuffer Опциональный Buffer с данными файла (для оптимизации обработки изображений и PDF)
 * @returns Объект с типом медиа и обработанными данными
 */
async function prepareMediaForClaude(
	filePath: string,
	fileBuffer?: Buffer,
): Promise<{
	mediaType: 'image' | 'pdf' | 'excel' | 'unknown';
	content: Buffer | string;
}> {
	const extension = path.extname(filePath).toLowerCase();

	// Обработка изображений
	if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(extension)) {
		// Если передан Buffer, используем его напрямую, иначе читаем файл
		const input = fileBuffer || filePath;
		const optimizedImage = await prepareImageForClaude(input);
		return { mediaType: 'image', content: optimizedImage };
	}

	// Обработка PDF
	else if (extension === '.pdf') {
		// Если передан Buffer, используем его напрямую, иначе читаем файл
		const input = fileBuffer || filePath;
		const { text, pageCount } = await extractTextFromPdf(input);
		const formattedText = `=== PDF документ (${pageCount} страниц) ===\n\n${text}`;
		return { mediaType: 'pdf', content: formattedText };
	}

	// Обработка Excel
	else if (['.xls', '.xlsx', '.csv'].includes(extension)) {
		const text = await extractTextFromExcel(filePath);
		const formattedText = `=== Excel документ ===\n\n${text}`;
		return { mediaType: 'excel', content: formattedText };
	}

	// Неизвестный формат
	else {
		throw new Error(`Unsupported file format: ${extension}`);
	}
}

/**
 * Проверяет статус Claude API и возвращает ошибку если API недоступно
 */
const checkApiHealth = (): ProcessingResult | null => {
	if (config.claudeApiStatus && !config.claudeApiStatus.isHealthy) {
		const timeSinceError = Date.now() - config.claudeApiStatus.lastErrorTime;
		if (timeSinceError < config.claudeApiStatus.cooldownPeriod) {
			log.warn(`Claude API в режиме охлаждения. Подождите ${Math.ceil((config.claudeApiStatus.cooldownPeriod - timeSinceError) / 1000)} секунд.`);
			return {
				success: false,
				error: `API Claude временно недоступно. Повторите запрос через ${Math.ceil((config.claudeApiStatus.cooldownPeriod - timeSinceError) / 1000)} секунд.`,
			};
		}
		// Сбрасываем статус
		config.claudeApiStatus.isHealthy = true;
		config.claudeApiStatus.consecutiveErrors = 0;
	}
	return null;
};

/**
 * Ожидает, пока количество активных запросов не станет меньше лимита
 */
const waitForAvailableSlot = async (): Promise<void> => {
	const maxRequests = config.maxParallelRequests || 3;
	while (activeRequests >= maxRequests) {
		log.info(`Достигнут лимит параллельных запросов (${maxRequests}). Ожидание...`);
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
};

/**
 * Создает запрос к Claude API для изображений
 */
const createImageRequest = async (content: Buffer): Promise<Anthropic.Message> => {
	const base64Image = content.toString('base64');

	return await anthropic.messages.create({
		model: config.claude.model || 'claude-sonnet-4-6',
		max_tokens: config.claude.maxTokens || 16000,
		system: 'You are an expert document and invoice analyzer. Extract all information accurately.',
		messages: [
			{
				role: 'user',
				content: [
					{ type: 'text', text: BASE_PROMPT },
					{
						type: 'image',
						source: {
							type: 'base64',
							media_type: 'image/jpeg',
							data: base64Image,
						},
					},
				],
			},
		],
	});
};

/**
 * Создает запрос к Claude API для текстовых документов
 */
const createTextRequest = async (content: string, extension: string): Promise<Anthropic.Message> => {
	const documentText = `${BASE_PROMPT}\n\nВот содержание документа:${
		extension === '.xls' || extension === '.xlsx' ? '\nЭто данные, извлеченные из Excel файла в текстовом формате.' : ''
	}\n\n${content}`;

	return await anthropic.messages.create({
		model: config.claude.model || 'claude-sonnet-4-6',
		max_tokens: config.claude.maxTokens || 16000,
		system: 'You are an expert document and invoice analyzer. Extract all information accurately.',
		messages: [
			{
				role: 'user',
				content: documentText,
			},
		],
	});
};

/**
 * Обрабатывает ошибки API с механизмом повторных попыток
 */
const handleApiError = async (error: any, retryCount: number, retryDelay: number): Promise<never> => {
	if ((error.status === 529 || error.status === 429) && retryCount < RETRY_CONFIG.MAX_RETRIES) {
		const newRetryCount = retryCount + 1;
		log.warn(`Получена ошибка API ${error.status}, повторная попытка ${newRetryCount}/${RETRY_CONFIG.MAX_RETRIES} через ${retryDelay / 1000}с`);

		// Обновляем статус API
		config.claudeApiStatus.consecutiveErrors++;

		// Если это ошибка лимита, используем Retry-After из заголовка
		if (error.status === 429 && error.headers && error.headers['retry-after']) {
			const retryAfterHeader = error.headers['retry-after'];
			let retryAfter;

			try {
				retryAfter = parseInt(retryAfterHeader) * 1000;
				if (isNaN(retryAfter) || retryAfter <= 0) {
					retryAfter = retryDelay;
					log.warn(`Некорректный заголовок retry-after: ${retryAfterHeader}, используем задержку по умолчанию: ${retryDelay}мс`);
				}
			} catch (parseError) {
				retryAfter = retryDelay;
				log.warn(`Ошибка парсинга заголовка retry-after: ${retryAfterHeader}, используем задержку по умолчанию: ${retryDelay}мс`);
			}

			log.info(`Ожидание ${retryAfter / 1000}с как указано в заголовке retry-after`);
			await new Promise((resolve) => setTimeout(resolve, retryAfter));
		} else {
			await new Promise((resolve) => setTimeout(resolve, retryDelay));
		}

		// Если более 3 ошибок подряд, помечаем API как недоступный
		if (config.claudeApiStatus.consecutiveErrors >= 3) {
			config.claudeApiStatus.isHealthy = false;
			config.claudeApiStatus.lastErrorTime = Date.now();
			log.warn(`Claude API помечен как недоступный. Режим охлаждения на ${config.claudeApiStatus.cooldownPeriod / 1000} секунд.`);
		}

		throw { ...error, retryCount: newRetryCount, retryDelay: retryDelay * RETRY_CONFIG.DELAY_MULTIPLIER };
	}

	// Обновляем статус API для других ошибок
	config.claudeApiStatus.consecutiveErrors++;
	if (config.claudeApiStatus.consecutiveErrors >= 3) {
		config.claudeApiStatus.isHealthy = false;
		config.claudeApiStatus.lastErrorTime = Date.now();
	}

	throw error;
};

/**
 * Выполняет запрос к Claude API с механизмом повторных попыток
 */
const makeRequestWithRetry = async (mediaType: string, content: Buffer | string, extension: string): Promise<Anthropic.Message> => {
	let retryCount = 0;
	let retryDelay = RETRY_CONFIG.INITIAL_DELAY;

	while (true) {
		try {
			if (mediaType === 'image') {
				return await createImageRequest(content as Buffer);
			} else {
				return await createTextRequest(content as string, extension);
			}
		} catch (error: any) {
			// Если это повторная попытка (есть флаг retryCount), используем его
			if (error.retryCount !== undefined) {
				retryCount = error.retryCount;
				retryDelay = error.retryDelay;
			}

			await handleApiError(error, retryCount, retryDelay);
		}
	}
};

/**
 * Парсит ответ от Claude API
 */
const parseClaudeResponse = (response: Anthropic.Message): ProcessingResult => {
	// Сбрасываем счетчик ошибок при успешном запросе
	config.claudeApiStatus.consecutiveErrors = 0;

	// Обрабатываем ответ
	if (response.content && response.content.length > 0) {
		const responseContent = response.content[0];
		// Проверяем, что блок имеет тип text
		if ('text' in responseContent) {
			const text = responseContent.text;

			// Ищем JSON в ответе
			const jsonMatch = text.match(/\{[\s\S]*\}/);

			if (jsonMatch) {
				try {
					const parsedData = JSON.parse(jsonMatch[0]) as ParsedDocument;
					return {
						success: true,
						data: parsedData,
					};
				} catch (jsonError) {
					log.error('Ошибка парсинга JSON из ответа Claude', { jsonError, filePath: 'unknown', response });
					return {
						success: false,
						error: 'Не удалось распарсить извлеченные данные из ответа Claude.',
					};
				}
			} else {
				return {
					success: false,
					error: 'Claude не вернул корректные JSON данные.',
				};
			}
		} else {
			return {
				success: false,
				error: 'Claude API вернул неподдерживаемый тип контента.',
			};
		}
	} else {
		return {
			success: false,
			error: 'Claude API вернул пустой ответ.',
		};
	}
};

/**
 * Основная функция для обработки документа через Claude API
 * Поддерживает обработку изображений, PDF и Excel файлов
 * @param filePath Локальный путь к файлу
 * @param originalFilePath Исходный путь в Telegram (опционально)
 * @param fileBuffer Buffer с данными файла (для оптимизации обработки изображений и PDF)
 * @returns Результат обработки с извлеченными данными
 */
export async function processDocumentWithFlexibleExtraction(filePath: string, originalFilePath?: string, fileBuffer?: Buffer): Promise<ProcessingResult> {
	try {
		// Проверяем статус API
		const healthCheck = checkApiHealth();
		if (healthCheck) {
			return healthCheck;
		}

		// Ожидаем доступного слота для запроса
		await waitForAvailableSlot();

		// Увеличиваем счетчик активных запросов
		activeRequests++;

		log.info(`Обработка документа через Claude API: ${filePath}`);
		const extension = path.extname(filePath).toLowerCase();

		// Подготавливаем медиа для Claude
		const { mediaType, content } = await prepareMediaForClaude(filePath, fileBuffer);

		// Выполняем запрос с механизмом повторных попыток
		const response = await makeRequestWithRetry(mediaType, content, extension);

		// Парсим ответ
		return parseClaudeResponse(response);
	} catch (error) {
		log.error('Ошибка обработки документа через Claude API', { error, filePath });
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Неизвестная ошибка в обработке Claude',
		};
	} finally {
		// Уменьшаем счетчик активных запросов в любом случае
		activeRequests = Math.max(0, activeRequests - 1);
	}
}
