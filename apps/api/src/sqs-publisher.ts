import { SendMessageBatchCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { DomainEvent, EventPublisher } from '@purr/domain';

/** Domain events onto the indexer's queue, ten to a batch. */
export class SqsEventPublisher implements EventPublisher {
  constructor(
    private readonly queueUrl: string,
    private readonly client: Pick<SQSClient, 'send'> = new SQSClient({}),
  ) {}

  async publish(events: DomainEvent[]): Promise<void> {
    for (let i = 0; i < events.length; i += 10) {
      const batch = events.slice(i, i + 10);
      const res = await this.client.send(
        new SendMessageBatchCommand({
          QueueUrl: this.queueUrl,
          Entries: batch.map((e, j) => ({ Id: String(j), MessageBody: JSON.stringify(e) })),
        }),
      );
      if (res.Failed && res.Failed.length > 0) {
        throw new Error(`SQS refused ${res.Failed.length} event(s): ${res.Failed[0]?.Message ?? 'unknown'}`);
      }
    }
  }
}
