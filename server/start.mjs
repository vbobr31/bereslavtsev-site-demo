import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp, isEmail } from './app.mjs';
import { createBot, telegram } from './bot.mjs';
import { emailNotifier } from './email.mjs';

process.umask(0o077);
const { HOST = '127.0.0.1', PORT = '8080', PUBLIC_ORIGIN = 'http://127.0.0.1:' + PORT,
  DATABASE_PATH = './data/appointments.sqlite', APP_MODE = 'test', BOT_TOKEN,
  OWNER_IDS = '', LEGAL_DIR, CONSENT_VERSION = 'test-v1', TELEGRAM_PERSONAL_DATA, NOTIFY_EMAIL, EMAIL_FROM, RESEND_API_KEY } = process.env;
if (!['test', 'live'].includes(APP_MODE)) throw Error('APP_MODE must be test or live');
const owners = OWNER_IDS.split(',').map(id => id.trim()).filter(Boolean);
if (owners.some(id => !/^\d+$/.test(id)) || (BOT_TOKEN && !owners.length)) throw Error('Set valid OWNER_IDS');
if (BOT_TOKEN && !/^\d+:[\w-]+$/.test(BOT_TOKEN)) throw Error('Invalid BOT_TOKEN format');
const emailEnabled = Boolean(NOTIFY_EMAIL || EMAIL_FROM || RESEND_API_KEY);
if (emailEnabled && (APP_MODE !== 'live' || !isEmail(NOTIFY_EMAIL) || !isEmail(EMAIL_FROM) || !RESEND_API_KEY)) {
  throw Error('Email requires live mode, NOTIFY_EMAIL, EMAIL_FROM and RESEND_API_KEY.');
}
const legal = {};
if (APP_MODE === 'live') {
  if (!BOT_TOKEN || !LEGAL_DIR || CONSENT_VERSION === 'test-v1' ||
      TELEGRAM_PERSONAL_DATA !== 'approved' || !/^https:\/\/[^/]+$/.test(PUBLIC_ORIGIN)) {
    throw Error('Live mode requires HTTPS origin, approved Telegram data flow, bot credentials and versioned legal documents.');
  }
  for (const file of ['privacy.html', 'consent.html']) legal[file] = await readFile(join(LEGAL_DIR, file));
}
await mkdir(dirname(DATABASE_PATH), { recursive: true });
const app = createApp({ database: DATABASE_PATH, origin: PUBLIC_ORIGIN, mode: APP_MODE,
  consentVersion: CONSENT_VERSION, legal, emailRecipient: emailEnabled ? NOTIFY_EMAIL : '' });
const transport = BOT_TOKEN ? telegram(BOT_TOKEN) : {
  send: async (_id, text) => console.log('[mock Telegram]', text)
};
const bot = createBot({ app, transport, owners: owners.length ? owners : ['1'],
  shareDetails: APP_MODE === 'live' || !BOT_TOKEN });
app.server.listen(Number(PORT), HOST, () => console.log(`HTTP listening on ${HOST}:${PORT} · ${APP_MODE}`));

async function notifications() {
  for (;;) {
    try { await bot.notify(); } catch { console.error('Telegram notification failed. Will retry.'); }
    await delay(3000);
  }
}
async function updates() {
  let offset = 0;
  for (;;) {
    try {
      for (const update of await transport.updates(offset)) {
        await bot.handle(update);
        offset = update.update_id + 1;
      }
    } catch {
      console.error('Telegram update failed. Will retry.');
      await delay(4000);
    }
  }
}
if (emailEnabled) {
  const notifyEmail = emailNotifier({ db: app.db, token: RESEND_API_KEY, from: EMAIL_FROM });
  void (async () => {
    for (;;) {
      try { await notifyEmail(); } catch { console.error('Email notification failed. Will retry.'); }
      await delay(30000);
    }
  })();
}
void notifications();
if (BOT_TOKEN) void updates();
