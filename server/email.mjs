import { createHash } from 'node:crypto';

export function emailNotifier({ db, token, from, send = fetch }) {
  const pending = db.prepare(`
    SELECT email_outbox.*, appointments.request_key
    FROM email_outbox JOIN appointments ON appointments.id=email_outbox.appointment_id
    WHERE sent=0 ORDER BY appointment_id LIMIT 10
  `);
  const delivered = db.prepare('UPDATE email_outbox SET sent=1 WHERE appointment_id=?');
  return async () => {
    for (const row of pending.all()) {
      const subject = `Новая заявка №${row.appointment_id}`;
      const idempotencyKey = createHash('sha256').update(row.request_key).digest('hex');
      const response = await send('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
          'Idempotency-Key': `consultation/${idempotencyKey}` },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({ from, to: [row.recipient], subject,
          text: 'Поступила новая заявка на консультацию. Проверьте список заявок.' })
      });
      if (!response.ok) throw new Error('Email provider rejected notification');
      delivered.run(row.appointment_id);
    }
  };
}
