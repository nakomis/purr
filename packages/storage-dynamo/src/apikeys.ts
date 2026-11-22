import type { ApiKeyRecord, ApiKeyRepository } from '@purr/domain';
import { fromItem, toItem } from './codec.js';
import type { Db } from './db.js';
import { keys } from './keys.js';

export function apiKeyRepository(db: Db): ApiKeyRepository {
  return {
    async findByHash(hash) {
      const item = await db.get(keys.apiKey(hash));
      return item ? fromItem<ApiKeyRecord>(item) : undefined;
    },
    async put(record) {
      await db.put(toItem(record, keys.apiKey(record.hash)));
    },
  };
}
