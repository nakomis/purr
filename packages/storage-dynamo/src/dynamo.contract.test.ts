import { randomUUID } from 'node:crypto';
import { CreateTableCommand, DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';
import { runStorageContract } from '@purr/contracts';
import { rankBetween, ValidationError, VersionMismatchError } from '@purr/domain';
import { describe, expect, it } from 'vitest';
import { createDynamoStorage } from './index.js';
import { createTableInput } from './table.js';

const endpoint = process.env.DYNAMO_ENDPOINT ?? 'http://localhost:8000';
const client = new DynamoDBClient({
  endpoint,
  region: 'eu-west-2',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  maxAttempts: 1,
});

async function reachable(): Promise<boolean> {
  try {
    await client.send(new ListTablesCommand({ Limit: 1 }), { abortSignal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}

const up = await reachable();

if (!up && process.env.DYNAMO_REQUIRED === '1') {
  describe('storage contract: dynamo', () => {
    it(`needs DynamoDB Local at ${endpoint} (DYNAMO_REQUIRED=1)`, () => {
      throw new Error(`DynamoDB Local is unreachable at ${endpoint}, and DYNAMO_REQUIRED=1`);
    });
  });
} else if (!up) {
  console.warn(
    `[storage-dynamo] DynamoDB Local is unreachable at ${endpoint}: skipping the storage contract. ` +
      'Start it with `docker run -p 8000:8000 amazon/dynamodb-local` (CI sets DYNAMO_REQUIRED=1).',
  );
  describe.skip('storage contract: dynamo (DynamoDB Local not running)', () => {
    it('is skipped', () => {});
  });
} else {
  // A fresh, uniquely named table per test keeps every test isolated.
  const make = async () => {
    const tableName = `purr-test-${randomUUID()}`;
    await client.send(new CreateTableCommand(createTableInput(tableName)));
    return createDynamoStorage({ tableName, client });
  };

  runStorageContract('dynamo', make);

  describe('dynamo specifics', () => {
    it('getMany reads more than one BatchGetItem chunk, in order', async () => {
      const s = await make();
      const p = await s.projects.create({ prefix: 'BIG', name: 'Big' });
      await Promise.all(
        Array.from({ length: 120 }, (_, i) => s.tasks.create({ projectId: p.id, title: `t${i}` }, 'bau')),
      );
      const refs = Array.from({ length: 120 }, (_, i) => `BIG-${120 - i}`);
      const got = await s.tasks.getMany([...refs, 'BIG-999']);
      expect(got.map((t) => t.ref)).toEqual(refs);
    });

    it('filtered pages still fill up to the limit and resume from the cursor', async () => {
      const s = await make();
      const p = await s.projects.create({ prefix: 'FLT', name: 'Filter' });
      for (let i = 0; i < 12; i++) {
        await s.tasks.create({ projectId: p.id, title: `t${i}`, labels: i % 3 === 0 ? ['x'] : [] }, 'bau');
      }
      const first = await s.tasks.listByProject(p.id, { label: 'x', limit: 3 });
      expect(first.items.map((t) => t.ref)).toEqual(['FLT-1', 'FLT-4', 'FLT-7']);
      const second = await s.tasks.listByProject(p.id, {
        label: 'x',
        limit: 3,
        cursor: first.cursor as string,
      });
      expect(second.items.map((t) => t.ref)).toEqual(['FLT-10']);
      expect(second.cursor).toBeUndefined();
    });

    it('rejects a cursor from another list', async () => {
      const s = await make();
      const a = await s.projects.create({ prefix: 'AAA', name: 'A' });
      const b = await s.projects.create({ prefix: 'BBB', name: 'B' });
      for (let i = 0; i < 3; i++) await s.tasks.create({ projectId: a.id, title: `t${i}` }, 'bau');
      const page = await s.tasks.listByProject(a.id, { limit: 1 });
      await expect(s.tasks.listByProject(b.id, { cursor: page.cursor as string })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('concurrent relations on one task all land', async () => {
      const s = await make();
      const p = await s.projects.create({ prefix: 'REL', name: 'Rel' });
      for (let i = 0; i < 6; i++) await s.tasks.create({ projectId: p.id, title: `t${i}` }, 'bau');
      await Promise.all(
        [2, 3, 4, 5, 6].map((n) => s.tasks.addRelation('REL-1', 'relates_to', `REL-${n}`, 'bau')),
      );
      expect((await s.tasks.get('REL-1')).relations).toHaveLength(5);
      for (const n of [2, 3, 4, 5, 6]) {
        expect((await s.tasks.get(`REL-${n}`)).relations).toEqual([{ type: 'relates_to', target: 'REL-1' }]);
      }
    });

    it('concurrent addTask to one epic keeps every membership and the project flag', async () => {
      const s = await make();
      const p = await s.projects.create({ prefix: 'EPX', name: 'Epx' });
      for (let i = 0; i < 6; i++) await s.tasks.create({ projectId: p.id, title: `t${i}` }, 'bau');
      const e = await s.epics.create({ name: 'e' }, 'bau');
      await Promise.all([1, 2, 3, 4, 5, 6].map((n) => s.epics.addTask(e.ref, `EPX-${n}`)));
      expect(await s.epics.listTasks(e.ref)).toHaveLength(6);
      expect((await s.epics.get(e.ref)).projectIds).toEqual([p.id]);
    });

    it('moving a task re-sorts the project list and survives a stale update', async () => {
      const s = await make();
      const p = await s.projects.create({ prefix: 'MOV', name: 'Mov' });
      await s.tasks.create({ projectId: p.id, title: 'a' }, 'bau');
      await s.tasks.create({ projectId: p.id, title: 'b' }, 'bau');
      const moved = await s.tasks.moveInProject(
        'MOV-2',
        rankBetween(undefined, (await s.tasks.get('MOV-1')).projectRank),
        'bau',
      );
      expect(moved.version).toBe(2);
      expect((await s.tasks.listByProject(p.id)).items.map((t) => t.ref)).toEqual(['MOV-2', 'MOV-1']);
      await expect(s.tasks.update('MOV-2', { title: 'x' }, 1, 'bau')).rejects.toBeInstanceOf(
        VersionMismatchError,
      );
    });
  });
}
