import type { Activity, ActivityRepository } from '@purr/domain';
import { fromItem } from './codec.js';
import type { Db } from './db.js';
import { keys } from './keys.js';

export function activityRepository(db: Db): ActivityRepository {
  return {
    async list(taskRef) {
      const items = await db.queryAll({ attribute: 'PK', partition: keys.activityPartition(taskRef) });
      return items.map((i) => fromItem<Activity>(i));
    },
  };
}
