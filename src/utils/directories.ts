import { config } from '../config';
import { createScopedLogger } from '../services/logger';
import fs from 'fs';

const log = createScopedLogger('directories');

export function ensureDirectoryExists(directoryPath: string): void {
	if (!fs.existsSync(directoryPath)) {
		log.info('Создание директории', { directoryPath });
		fs.mkdirSync(directoryPath, { recursive: true });
	}
}

export const setupDefaultDirectories = (): void => {
	log.info('Проверка рабочих директорий');
	ensureDirectoryExists(config.paths.uploads);
	log.info('Рабочая директория готова', { uploads: config.paths.uploads });
};
