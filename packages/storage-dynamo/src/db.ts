/**
 * A thin layer over the DocumentClient: every expression uses #name placeholders
 * (names like name, state, version and rank are all DynamoDB reserved words),
 * and DynamoDB's failures are translated into the domain errors.
 */
import {
  BatchGetCommand,
  DeleteCommand,
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ConflictError } from '@purr/domain';
import { chunk, decodeCursor, encodeCursor, type Item, keyOf } from './codec.js';
import type { Key } from './keys.js';

/** Thrown inside an operation when a re-read and a second attempt may succeed. */
export class RetryError extends Error {
  constructor() {
    super('retry');
    this.name = 'RetryError';
  }
}

/** What a failed condition means for one operation of a transaction. */
export type Failure = (() => Error) | 'retry';

export interface Condition {
  expression: string;
  names: Record<string, string>;
  values?: Record<string, unknown>;
}

export const cond = {
  notExists: (): Condition => ({ expression: 'attribute_not_exists(#pk)', names: { '#pk': 'PK' } }),
  exists: (): Condition => ({ expression: 'attribute_exists(#pk)', names: { '#pk': 'PK' } }),
  versionIs: (version: number): Condition => ({
    expression: '#version = :expected',
    names: { '#version': 'version' },
    values: { ':expected': version },
  }),
};

export type TxOp =
  | { put: Item; condition?: Condition; fail?: Failure }
  | { delete: Key; condition?: Condition; fail?: Failure }
  | { check: Key; condition: Condition; fail?: Failure };

export interface QueryOptions {
  /** Which key attribute names the partition; 'GSI1PK' queries GSI1. */
  attribute: 'PK' | 'GSI1PK';
  partition: string;
  /** Primary-table queries only: restrict the sort key to this prefix. */
  skPrefix?: string;
  descending?: boolean;
  limit?: number;
  cursor?: string;
  /** Applied to each item as it is read; the page still fills up to `limit`. */
  accept?: (item: Item) => boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const backoff = (attempt: number) => sleep(Math.random() * 15 * (attempt + 1));

export function isConditionalFailure(e: unknown): boolean {
  return e instanceof Error && e.name === 'ConditionalCheckFailedException';
}

export class Db {
  constructor(
    readonly doc: DynamoDBDocumentClient,
    readonly table: string,
  ) {}

  async get(key: Key): Promise<Item | undefined> {
    const res = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: key, ConsistentRead: true }),
    );
    return res.Item;
  }

  /** BatchGetItem in chunks of 100, retrying unprocessed keys. Results are unordered. */
  async batchGet(keysToGet: Key[]): Promise<Item[]> {
    const unique = [...new Map(keysToGet.map((k) => [`${k.PK}\u0000${k.SK}`, k])).values()];
    const out: Item[] = [];
    for (const group of chunk(unique, 100)) {
      let pending: Key[] = group;
      for (let attempt = 0; pending.length > 0; attempt++) {
        if (attempt > 0) {
          if (attempt > 8) throw new Error('DynamoDB left keys unprocessed after 8 retries');
          await backoff(attempt);
        }
        const res = await this.doc.send(
          new BatchGetCommand({
            RequestItems: { [this.table]: { Keys: pending, ConsistentRead: true } },
          }),
        );
        out.push(...((res.Responses?.[this.table] as Item[] | undefined) ?? []));
        pending = (res.UnprocessedKeys?.[this.table]?.Keys as Key[] | undefined) ?? [];
      }
    }
    return out;
  }

  async put(item: Item, condition?: Condition): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: item,
        ...(condition
          ? {
              ConditionExpression: condition.expression,
              ExpressionAttributeNames: condition.names,
              ...(condition.values ? { ExpressionAttributeValues: condition.values } : {}),
            }
          : {}),
      }),
    );
  }

  async delete(key: Key): Promise<void> {
    await this.doc.send(new DeleteCommand({ TableName: this.table, Key: key }));
  }

  /** Atomically adds one to a counter and returns the new value. */
  async nextCounter(key: Key): Promise<number> {
    const res = await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: key,
        UpdateExpression: 'ADD #seq :one',
        ExpressionAttributeNames: { '#seq': 'seq' },
        ExpressionAttributeValues: { ':one': 1 },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    return Number(res.Attributes?.seq);
  }

  /** Raises a counter to at least `value`; never lowers it. */
  async raiseCounter(key: Key, value: number): Promise<void> {
    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: key,
          UpdateExpression: 'SET #seq = :value',
          ConditionExpression: 'attribute_not_exists(#seq) OR #seq < :value',
          ExpressionAttributeNames: { '#seq': 'seq' },
          ExpressionAttributeValues: { ':value': value },
        }),
      );
    } catch (e) {
      if (!isConditionalFailure(e)) throw e;
    }
  }

  /**
   * One page of a Query, filling up to `limit` accepted items. The cursor is the
   * key of the last item returned, present only when more remain.
   */
  async queryPage(opts: QueryOptions): Promise<{ items: Item[]; cursor?: string }> {
    const indexed = opts.attribute === 'GSI1PK';
    const limit = opts.limit ?? Number.POSITIVE_INFINITY;
    const skName = indexed ? 'GSI1SK' : 'SK';
    let startKey: Record<string, unknown> | undefined = decodeCursor(
      opts.cursor,
      { attribute: opts.attribute, value: opts.partition },
      indexed,
    );
    const collected: Item[] = [];
    while (collected.length <= limit) {
      const want = Number.isFinite(limit) ? limit + 1 - collected.length : undefined;
      const res = await this.doc.send(
        new QueryCommand({
          TableName: this.table,
          ...(indexed ? { IndexName: 'GSI1' } : { ConsistentRead: true }),
          KeyConditionExpression: opts.skPrefix ? '#pk = :pk AND begins_with(#sk, :skPrefix)' : '#pk = :pk',
          ExpressionAttributeNames: { '#pk': opts.attribute, ...(opts.skPrefix ? { '#sk': skName } : {}) },
          ExpressionAttributeValues: {
            ':pk': opts.partition,
            ...(opts.skPrefix ? { ':skPrefix': opts.skPrefix } : {}),
          },
          ScanIndexForward: !opts.descending,
          ...(want !== undefined ? { Limit: opts.accept ? Math.max(want, 50) : want } : {}),
          ...(startKey ? { ExclusiveStartKey: startKey } : {}),
        }),
      );
      for (const item of (res.Items ?? []) as Item[]) {
        if (!opts.accept || opts.accept(item)) {
          collected.push(item);
          if (collected.length > limit) break;
        }
      }
      startKey = res.LastEvaluatedKey;
      if (!startKey) break;
    }
    if (collected.length <= limit) return { items: collected };
    const items = collected.slice(0, limit);
    return { items, cursor: encodeCursor(keyOf(items[limit - 1] as Item, indexed)) };
  }

  async queryAll(opts: Omit<QueryOptions, 'limit' | 'cursor'>): Promise<Item[]> {
    return (await this.queryPage(opts)).items;
  }

  /** The first item in key order (or the last, if descending), if any. */
  async queryFirst(opts: Omit<QueryOptions, 'limit' | 'cursor' | 'accept'>): Promise<Item | undefined> {
    return (await this.queryPage({ ...opts, limit: 1 })).items[0];
  }

  /**
   * TransactWriteItems with failures translated: a failed condition becomes the
   * error its operation names (or a RetryError); contention with another
   * transaction is simply re-sent.
   */
  async transact(ops: TxOp[]): Promise<void> {
    const expression = (c: Condition) => ({
      ConditionExpression: c.expression,
      ExpressionAttributeNames: c.names,
      ...(c.values ? { ExpressionAttributeValues: c.values } : {}),
    });
    const items: TransactWriteCommandInput['TransactItems'] = ops.map((op) => {
      if ('check' in op) {
        return { ConditionCheck: { TableName: this.table, Key: op.check, ...expression(op.condition) } };
      }
      const condition = op.condition ? expression(op.condition) : {};
      if ('put' in op) return { Put: { TableName: this.table, Item: op.put, ...condition } };
      return { Delete: { TableName: this.table, Key: op.delete, ...condition } };
    });
    for (let attempt = 0; ; attempt++) {
      try {
        await this.doc.send(new TransactWriteCommand({ TransactItems: items }));
        return;
      } catch (e) {
        if (!(e instanceof Error)) throw e;
        const reasons = (e as { CancellationReasons?: { Code?: string }[] }).CancellationReasons ?? [];
        if (e.name === 'TransactionCanceledException') {
          const failed = reasons.findIndex((r) => r.Code === 'ConditionalCheckFailed');
          if (failed >= 0) {
            const fail = ops[failed]?.fail;
            if (fail === undefined) throw new ConflictError('a concurrent write got there first');
            throw fail === 'retry' ? new RetryError() : fail();
          }
          if (reasons.some((r) => r.Code === 'TransactionConflict') && attempt < 8) {
            await backoff(attempt);
            continue;
          }
        } else if (e.name === 'TransactionInProgressException' && attempt < 8) {
          await backoff(attempt);
          continue;
        }
        throw e;
      }
    }
  }
}

/** Runs an optimistic read-modify-write, repeating it when a RetryError says it lost a race. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 10): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof RetryError)) throw e;
      if (attempt + 1 >= attempts) throw new ConflictError('too many concurrent writes; try again');
      await backoff(attempt);
    }
  }
}
