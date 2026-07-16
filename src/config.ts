import dotenv from 'dotenv';
import path from 'path';
import { Config } from './types/types';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Validate required environment variables
const requiredEnvVars = ['TELEGRAM_BOT_TOKEN', 'CLAUDE_API_KEY'];
const missingEnvVars = requiredEnvVars.filter((varName) => !process.env[varName]);

if (missingEnvVars.length > 0) {
	throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

export const config: Config = {
	telegram: {
		token: process.env.TELEGRAM_BOT_TOKEN!,
	},
	claude: {
		apiKey: process.env.CLAUDE_API_KEY!,
		model: 'claude-sonnet-4-6', // можно указать модель: claude-3-opus-20240229, claude-3-sonnet-20240229, claude-3-haiku-20240307 или claude-3-7-sonnet-20250219
		maxTokens: 16000,
	},
	paths: {
		uploads: path.resolve(__dirname, '../uploads'),
		files: path.resolve(__dirname, '../../files'),
	},
	claudeApiStatus: {
		isHealthy: true,
		lastErrorTime: 0,
		cooldownPeriod: 60000, // 1 минута охлаждения при ошибках
		consecutiveErrors: 0,
	},
	maxParallelRequests: 3, // максимум параллельных запросов к API
};
