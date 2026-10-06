import type { Database, Transaction } from '../db/database';

export async function handleOnce(
  db: Database,
  consumer: string,
  messageId: string,
  work: (tx: Transaction) => Promise<void>,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const inserted = await tx.query(
      'INSERT INTO processed_messages (message_id, consumer) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [messageId, consumer],
    );
    if (inserted.rowCount === 0) return false;
    await work(tx);
    return true;
  });
}
