/**
 * Промпт и JSON-схема для извлечения данных из счетов/накладных.
 * Structured output через tool_use (extract_invoice).
 */
import type Anthropic from '@anthropic-ai/sdk';

export const SYSTEM_PROMPT =
	'You are an expert invoice and delivery-note analyzer for Ukrainian/Russian/English documents. ' +
	'Never invent values. Never recalculate prices — only copy numbers from the document.';

export const EXTRACT_INVOICE_TOOL_NAME = 'extract_invoice';

/** JSON Schema для принудительного structured output через tool_use */
export const EXTRACT_INVOICE_TOOL: Anthropic.Tool = {
	name: EXTRACT_INVOICE_TOOL_NAME,
	description: 'Структурированные данные счёта/накладной, извлечённые из документа.',
	input_schema: {
		type: 'object',
		properties: {
			invoice_number: {
				type: ['string', 'null'],
				description: 'Номер счёта/рахунку-фактури как в документе (сохраняй префиксы и разделители, напр. "Л-25/46")',
			},
			invoice_date: {
				type: ['string', 'null'],
				description: 'Дата счёта в формате DD.MM.YYYY',
			},
			edrpou: {
				type: ['string', 'null'],
				description: 'ЄДРПОУ/ЕДРПОУ поставщика: 8 цифр (юрлицо) или 10 цифр (ФОП). Только цифры.',
			},
			ipn: {
				type: ['string', 'null'],
				description: 'ІПН/ИНН поставщика: 10–12 цифр. Только цифры.',
			},
			supplier: {
				type: ['string', 'null'],
				description: 'Название поставщика (контрагента)',
			},
			isPriceWithPdv: {
				type: 'boolean',
				description: 'true, если цены в таблице указаны с ПДВ/НДС; иначе false',
			},
			items: {
				type: 'array',
				description: 'Позиции товаров/услуг/работ',
				items: {
					type: 'object',
					properties: {
						name: {
							type: ['string', 'null'],
							description: 'Наименование позиции',
						},
						article: {
							type: ['string', 'null'],
							description: 'Артикул / код товара (может содержать буквы разных языков)',
						},
						quantity: {
							type: ['number', 'null'],
							description: 'Количество (число). Если в ячейке "100шт" — quantity и unit раздели корректно',
						},
						unit: {
							type: ['string', 'null'],
							description: 'Единица измерения: шт, кг, м, м², м³, л, од, год (часы) и т.п.',
						},
						price_no_pdv: {
							type: ['number', 'null'],
							description: 'Цена за единицу без ПДВ (как в документе, без пересчёта)',
						},
						price_with_pdv: {
							type: ['number', 'null'],
							description: 'Цена за единицу с ПДВ (как в документе, без пересчёта)',
						},
						total_no_pdv: {
							type: ['number', 'null'],
							description: 'Сумма позиции без ПДВ',
						},
						total_with_pdv: {
							type: ['number', 'null'],
							description: 'Сумма позиции с ПДВ',
						},
					},
					required: [
						'name',
						'article',
						'quantity',
						'unit',
						'price_no_pdv',
						'price_with_pdv',
						'total_no_pdv',
						'total_with_pdv',
					],
					additionalProperties: false,
				},
			},
			total_no_pdv: {
				type: ['number', 'null'],
				description: 'Итоговая сумма документа без ПДВ',
			},
			total_pdv: {
				type: ['number', 'null'],
				description: 'Сумма ПДВ по документу',
			},
			total_with_pdv: {
				type: ['number', 'null'],
				description: 'Итоговая сумма документа с ПДВ',
			},
		},
		required: [
			'invoice_number',
			'invoice_date',
			'edrpou',
			'ipn',
			'supplier',
			'isPriceWithPdv',
			'items',
			'total_no_pdv',
			'total_pdv',
			'total_with_pdv',
		],
		additionalProperties: false,
	},
};

/**
 * Инструкции по извлечению. Формат ответа задаётся schema tool extract_invoice.
 */
export const BASE_PROMPT = `Проанализируй документ (укр/рус/англ) и заполни поля tool "${EXTRACT_INVOICE_TOOL_NAME}".

Типы входа:
- PDF (в т.ч. несколько страниц, сканы, таблицы)
- фото / скриншот счёта
- Excel как CSV (листы: "=== Лист: <имя> ===")

Ищи реквизиты и таблицу по всему документу — они могут быть на разных страницах/листах.
В таблицах сохраняй соответствие колонок: наименование, количество, единица, цена, сумма.
Не пересчитывай цены и суммы — только считывай значения из документа в нужные поля.
Если поле нельзя надёжно определить — ставь null (для isPriceWithPdv — false, если ПДВ нигде не упомянут).

=== ЄДРПОУ / ЕДРПОУ (поставщик) ===
- Ищи рядом с метками: "код за ЄДРПОУ", "ЄДРПОУ", "Код ЄДРПОУ", "ЕДРПОУ"
- Юрлицо: обычно 8 цифр; ФОП/ФЛП: обычно 10 цифр
- Копируй цифры ТОЧНО, без изменения порядка
- НЕ бери: р/с, IBAN (UA...), МФО, № свід./свидетельства, номер счёта
- Пример: "код за ЄДРПОУ 35601501, ІПН 356015004822, № свід. 200026344"
  → edrpou="35601501", ipn="356015004822" (не 200026344)

=== ІПН / ИНН (поставщик) ===
- Ищи рядом с "ІПН" / "ИНН"
- 10–12 цифр; обычно сразу после ЄДРПОУ
- При сомнении — null, не угадывай

=== Номер и дата счёта ===
- invoice_number: сохраняй префиксы и разделители ("Л-25/46", "1234")
- invoice_date: DD.MM.YYYY

=== ПДВ / НДС (isPriceWithPdv) ===
- true, если есть колонки вроде "Ціна з ПДВ"/"Сума з ПДВ", пометка "в т.ч. ПДВ", или строка "У тому числі ПДВ"
- false, если ПДВ/НДС в документе не упомянуты
- Если в документе есть и суммы без ПДВ, и с ПДВ — заполни оба набора полей (*_no_pdv и *_with_pdv / total_pdv)

=== Единицы измерения ===
- Всегда разделяй quantity (number) и unit (string)
- "100 шт" / "100шт" в одной ячейке → quantity=100, unit="шт"
- Частые unit: шт, кг, м, м², м³, л, од, год (години = часы)
- Не подставляй число фасовки вместо quantity, если количество уже есть в отдельной колонке`;
