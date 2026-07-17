import type { Message } from 'node-telegram-bot-api';

export interface DocumentItem {
	name: string | null; // "Кирпич"
	article: string | null; // "1234567890 || КР 2.04 || ZST10230-04079"
	quantity: number | null; // 1000
	unit: string | null; // "шт"
	price_no_pdv: number | null; // 100
	price_with_pdv: number | null; // 110
	total_no_pdv: number | null; // 10000
	total_with_pdv: number | null; // 11000
}

export interface ParsedDocument {
	invoice_number: string | null; // 1234
	invoice_date: string | null; // DD.MM.YYYY
	edrpou: string | null; // 1234567890
	ipn: string | null; // 1234567890
	supplier: string | null; // "ООО 'Стройматериалы'"
	isPriceWithPdv: boolean; // true
	items: DocumentItem[];
	total_no_pdv: number | null; // 10000
	total_pdv: number | null; // 1000
	total_with_pdv: number | null; // 11000
}

export interface ProcessingResult {
	success: boolean;
	data?: ParsedDocument;
	error?: string;
}

export type FileType = 'document' | 'photo';
export type ProcessingStatus = 'downloading' | 'analyzing' | 'completed';

export interface FilePaths {
	jsonPath: string;
	xlsxPath: string;
}

export interface ProcessingContext {
	chatId: number;
	fileType: FileType;
	fileName: string;
	statusMessage: Message;
}

export interface ClaudeApiStatus {
	isHealthy: boolean;
	lastErrorTime: number;
	cooldownPeriod: number;
	consecutiveErrors: number;
}

export interface Config {
	telegram: {
		token: string;
	};
	claude: {
		apiKey: string;
		model?: string;
		maxTokens?: number;
	};
	paths: {
		uploads: string;
		files: string;
	};
	claudeApiStatus: ClaudeApiStatus;
	maxParallelRequests: number;
}
