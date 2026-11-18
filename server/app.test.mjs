import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp } from './app.mjs';
import { emailNotifier } from './email.mjs';
import { createBot } from './bot.mjs';

test('HTTP: validation, retries, duplicate protection and unavailable storage', async t => {
  const origin = 'http://127.0.0.1';
  const app = createApp({ origin, emailRecipient: 'owner@example.test' });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(() => app.server.close());
  const url = origin + ':' + app.server.address().port;
  const data = { name: 'Тестовое Имя', phone: '+7 (999) 000-00-00', email: 'test@example.test',
    service: 'consultation', comment: '', consent: true, consentVersion: 'test-v1' };
  const post = (body, key = randomUUID(), source = origin) => fetch(url + '/api/appointments', {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key, origin: source },
    body: JSON.stringify(body)
  });
  assert.equal((await fetch(url)).status, 200);
  assert.equal((await fetch(url + '/architecture.jpg')).status, 200);
  assert.equal((await fetch(url + '/privacy.html')).status, 200);
  assert.equal((await post(data, randomUUID(), 'https://other.example')).status, 403);
  for (const fields of [{ consent: false }, { phone: 'abc' }, { service: 'hidden' }, { email: 'invalid' }, { phone: '+1 900 123 45 67' }]) {
    assert.equal((await post({ ...data, ...fields })).status, 422);
  }
  const key = randomUUID();
  const results = await Promise.all([post(data, key), post(data, key)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 201]);
  for (const result of results) assert.equal((await result.json()).id, 1);
  assert.equal((await post({ ...data, name: 'Изменено' }, key)).status, 409);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM appointments').get().count, 1);
  const sentEmails = [];
  const notifyEmail = emailNotifier({ db: app.db, token: 'mock', from: 'site@example.test',
    send: async (_url, options) => {
      sentEmails.push(JSON.parse(options.body));
      return { ok: sentEmails.length > 1 };
    }
  });
  await assert.rejects(notifyEmail());
  await notifyEmail();
  await notifyEmail();
  assert.equal(sentEmails.length, 2);
  assert.deepEqual(sentEmails[0], sentEmails[1]);
  assert.deepEqual(sentEmails[1].to, ['owner@example.test']);
  assert.doesNotMatch(JSON.stringify(sentEmails[1]), /Тестовое Имя|000-00-00/);
  for (const phone of ['89001234567', '9001234567', '+7 (900) 123-45-67']) {
    const response = await post({ ...data, phone, email: undefined });
    assert.equal(response.status, 201);
    const row = app.db.prepare('SELECT body FROM appointments WHERE id=?').get((await response.json()).id);
    const stored = JSON.parse(row.body);
    assert.equal(stored.phone, '+79001234567');
    assert.equal(stored.email, '');
  }
  app.db.close();
  assert.equal((await post(data)).status, 503);
});

test('Bot: allowlist, draft confirmation, and durable notification retry', async () => {
  const app = createApp();
  const sent = [];
  let down = false;
  const bot = createBot({ app, owners: ['31'], transport: { send: async (...args) => {
    if (down) throw Error('offline');
    sent.push(args);
  } } });
  const message = (text, id = 31, type = 'private') => ({ message: { text, from: { id }, chat: { type, id } } });
  const callback = data => ({ callback_query: { data, from: { id: 31 }, message: message('').message } });
  assert.equal(await bot.handle(message('/start', 12)), false);
  assert.equal(await bot.handle(message('/start', 31, 'group')), false);
  assert.equal(sent.length, 0);
  await bot.handle(callback('add'));
  await bot.handle(message('Проверка договора\nОписание услуги'));
  assert.equal(app.content().services.length, 1);
  const publish = sent.at(-1)[2].inline_keyboard[0][0].callback_data;
  await bot.handle(callback(publish));
  await bot.handle(callback(publish));
  const added = app.content().services[1];
  assert.equal(added.title, 'Проверка договора');
  await bot.handle(callback('visibility:' + added.id));
  assert.equal(app.content().services[1].visible, true);
  await bot.handle(callback(sent.at(-1)[2].inline_keyboard[0][0].callback_data));
  assert.equal(app.content().services[1].visible, false);

  app.db.prepare('INSERT INTO appointments (request_key, fingerprint, created, body) VALUES (?,?,?,?)')
    .run('test','test','2099-01-01','{"name":"Личные данные"}');
  down = true;
  await assert.rejects(bot.notify());
  down = false;
  await bot.notify();
  assert.equal(sent.at(-1)[1], 'Новая заявка №1');
  const sentCount = sent.length;
  await bot.notify();
  assert.equal(sent.length, sentCount);
  await bot.handle(callback('status:1:2'));
  assert.equal(app.db.prepare('SELECT status FROM appointments WHERE id=1').get().status, 2);
  assert.doesNotMatch(sent.at(-1)[1], /Личные данные/);
  app.db.close();
});
