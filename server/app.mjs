import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { normalizePhone } from '../site/phone.js';

const root = new URL('../site/', import.meta.url);
export const stages = ['Новая', 'Связались', 'Назначена', 'Закрыта'];
export const seed = {
  intro: 'Юридическая консультация, с которой можно начать разговор о вашей ситуации.',
  phone: '+7 (4722) 202-835', email: 'headlaw@mail.ru',
  services: [{ id: 'consultation', title: 'Первичная консультация',
    description: 'На первой встрече можно обсудить обстоятельства, уточнить, какие документы могут понадобиться, и определить дальнейшие шаги.', visible: true }]
};
const files = { '': 'index.html', 'index.html': 'index.html', 'style.css': 'style.css',
  'config.js': 'config.js', 'app.js': 'app.js', 'phone.js': 'phone.js', 'architecture.jpg': 'architecture.jpg',
  'about.html': 'about.html', 'services.html': 'services.html',
  'consultation.html': 'consultation.html', 'faq.html': 'faq.html',
  'contacts.html': 'contacts.html', 'contacts.js': 'contacts.js',
  'demo-requests.js': 'demo-requests.js',
  'documents.html': 'documents.html', 'representation.html': 'representation.html',
  'privacy.html': 'privacy.html', 'consent.html': 'consent.html', 'cookies.html': 'cookies.html' };
const types = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', jpg: 'image/jpeg' };
const emailPattern = /^[\w.!#$%&'*+/=?^\x60{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const phonePattern = /^\+?[\d ().-]{10,30}$/;
export const isEmail = value => typeof value === 'string' && value.length <= 160 && emailPattern.test(value);
export const isPhone = value => typeof value === 'string' && phonePattern.test(value) &&
  /^\d{10,15}$/.test(value.replace(/\D/g, ''));

const field = (value, max) => typeof value === 'string' && value.length <= max ? value.trim() : null;
export function createApp({ database = ':memory:', origin, mode = 'test', consentVersion = 'test-v1', legal = {}, emailRecipient = '' } = {}) {
  const db = new DatabaseSync(database);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS content (id INTEGER PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY, request_key TEXT UNIQUE NOT NULL, fingerprint TEXT NOT NULL,
      created TEXT NOT NULL, body TEXT NOT NULL, status INTEGER NOT NULL DEFAULT 0,
      notified INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS email_outbox (
      appointment_id INTEGER PRIMARY KEY, recipient TEXT NOT NULL,
      sent INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS drafts (owner TEXT PRIMARY KEY, token TEXT NOT NULL, body TEXT NOT NULL);
  `);
  db.prepare('INSERT OR IGNORE INTO content VALUES (1, ?)').run(JSON.stringify(seed));
  const content = () => JSON.parse(db.prepare('SELECT body FROM content WHERE id=1').get().body);
  function applyDraft(owner, token) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const draft = db.prepare('SELECT body FROM drafts WHERE owner=? AND token=?').get(owner, token);
      if (draft) {
        const change = JSON.parse(draft.body);
        const next = content();
        if (change.kind === 'contacts') Object.assign(next, { phone: change.phone, email: change.email });
        if (change.kind === 'intro') next.intro = change.text;
        if (change.kind === 'add') next.services.push({ ...change.service, id: randomUUID(), visible: true });
        const existing = next.services.find(item => item.id === change.id);
        if (change.kind === 'edit' && existing) Object.assign(existing, change.service);
        if (change.kind === 'visibility' && existing) existing.visible = change.visible;
        if (change.kind === 'delete') next.services = next.services.filter(item => item.id !== change.id);
        db.prepare('UPDATE content SET body=? WHERE id=1').run(JSON.stringify(next));
        db.prepare('DELETE FROM drafts WHERE owner=?').run(owner);
      }
      db.exec('COMMIT');
      return !!draft;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  const limits = new Map();
  function rateLimit(ip) {
    const now = Date.now();
    for (const [key, value] of limits) if (value.until <= now) limits.delete(key);
    if (!limits.has(ip)) limits.set(ip, { count: 0, until: now + 60000 });
    return ++limits.get(ip).count > 30;
  }
  const server = createServer(async (req, res) => {
    const send = (code, body, type = 'application/json; charset=utf-8') => {
      const headers = {
        'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
      };
      res.writeHead(code, headers);
      res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
    };
    const error = (code, message) => send(code, { error: message });
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/api/content') {
        const data = content();
        data.services = data.services.filter(service => service.visible);
        return send(200, data);
      }
      if (req.method === 'POST' && path === '/api/appointments') {
        if (req.headers.origin !== origin) return error(403, 'Обновите страницу и повторите отправку.');
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return error(415, 'Неподдерживаемый формат.');
        if (rateLimit(req.socket.remoteAddress)) return error(429, 'Повторите отправку через минуту.');
        const key = req.headers['idempotency-key'];
        if (typeof key !== 'string' || !/^[a-f0-9-]{36}$/i.test(key)) return error(400, 'Некорректный идентификатор заявки.');
        let raw = '';
        let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 4096) { error(413, 'Заявка слишком большая.'); return; }
          raw += chunk.toString('latin1');
        }
        const fingerprint = createHash('sha256').update(raw, 'latin1').digest('hex');
        const prior = db.prepare('SELECT id, fingerprint FROM appointments WHERE request_key=?').get(key);
        if (prior) return prior.fingerprint === fingerprint ? send(200, { id: prior.id }) : error(409, 'Поля заявки изменились. Повторите отправку.');
        let data;
        try { data = JSON.parse(Buffer.from(raw, 'latin1').toString('utf8')); }
        catch { return error(400, 'Некорректные данные.'); }
        if (!data || typeof data !== 'object') return error(400, 'Некорректные данные.');
        const name = field(data.name, 80);
        const phone = normalizePhone(data.phone);
        const email = field(data.email ?? '', 160);
        const comment = field(data.comment ?? '', 300);
        const service = content().services.find(item => item.visible && item.id === data.service);
        if (!name || !phone || email === null || (email && !isEmail(email)) ||
            comment === null || !service || data.consent !== true || data.consentVersion !== consentVersion) {
          return error(422, 'Проверьте имя, телефон, почту (если указана), услугу и согласие на обработку данных.');
        }
        const payload = { name, phone, email, comment, service: service.title, consentVersion };
        db.exec('BEGIN IMMEDIATE');
        try {
          const result = db.prepare('INSERT INTO appointments (request_key,fingerprint,created,body) VALUES (?,?,?,?)')
            .run(key, fingerprint, new Date().toISOString(), JSON.stringify(payload));
          const id = Number(result.lastInsertRowid);
          if (emailRecipient) db.prepare('INSERT INTO email_outbox (appointment_id,recipient) VALUES (?,?)')
            .run(id, emailRecipient);
          db.exec('COMMIT');
          return send(201, { id });
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      }
      if (req.method === 'GET' && Object.hasOwn(files, path.slice(1))) {
        const file = files[path.slice(1)];
        if (file === 'config.js') return send(200, `export const mode = ${JSON.stringify(mode)}; export const consentVersion = ${JSON.stringify(consentVersion)};`, types.js);
        if (mode === 'live' && Object.hasOwn(legal, file)) return send(200, legal[file], types.html);
        return send(200, await readFile(new URL(file, root)), types[file.split('.').at(-1)]);
      }
      return error(404, 'Страница не найдена.');
    } catch {
      return error(503, 'Сервис временно недоступен.');
    }
  });
  return { server, db, content, applyDraft };
}
