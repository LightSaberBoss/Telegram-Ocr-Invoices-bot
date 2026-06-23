import TelegramBot from 'node-telegram-bot-api';

export interface DocumentItem {
	name: string; // "Кирпич"
	article: string | null; // "1234567890 || КР 2.04 || ZST10230-04079"
	quantity: number; // 1000
	unit: string; // "шт"
	price_no_pdv: number; // 100
	price_with_pdv: number; // 110
	total_no_pdv: number; // 10000
	total_with_pdv: number; // 11000
}

export interface ParsedDocument {
	invoice_number: string; // 1234
	invoice_date: string; // DD.MM.YYYY
	edrpou: string; // 1234567890
	ipn: string; // 1234567890
	supplier: string; // "ООО 'Стройматериалы'"
	isPriceWithPdv: boolean; // true
	items: DocumentItem[];
	total_no_pdv: number; // 10000
	total_pdv: number; // 1000
	total_with_pdv: number; // 11000
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
	statusMessage: TelegramBot.Message;
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
	};
	claudeApiStatus: ClaudeApiStatus;
	maxParallelRequests: number;
}
