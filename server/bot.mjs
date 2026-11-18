import { randomUUID } from 'node:crypto';
import { isEmail, isPhone, stages } from './app.mjs';

const key = (text, callback_data) => ({ text, callback_data });
const home = [[key('Заявки', 'requests'), key('Услуги', 'services')],
  [key('Контакты', 'contacts'), key('Текст первого экрана', 'intro')], [key('Открыть черновик', 'draft')]];
const preview = [
  change => `Добавить услугу «${change.service.title}»\n${change.service.description}`,
  change => `Изменить услугу на «${change.service.title}»\n${change.service.description}`,
];
export function createBot({ app, owners, transport, shareDetails = false }) {
  const { db, content, applyDraft } = app;
  const waiting = new Map();
  const allowed = new Set(owners.map(String));
  const send = (id, text, buttons = home) => transport.send(id, text, { inline_keyboard: buttons });
  const showDraft = async (id, draft, token) => {
    if (!draft) return send(id, 'Черновик отсутствует.');
    const texts = {
      add: preview[0], edit: preview[1],
      contacts: d => `Обновить контакты\n${d.phone}\n${d.email}`,
      intro: d => `Текст первого экрана\n${d.text}`,
      visibility: d => `${d.visible ? 'Показать' : 'Скрыть'} услугу «${d.title}»`,
      delete: d => `Удалить услугу «${d.title}»`
    };
    return send(id, texts[draft.kind](draft), [[key('Опубликовать', 'ok:' + token), key('Отмена', 'no:' + token)]]);
  };
  function draft(id, change) {
    const token = randomUUID();
    db.prepare('INSERT OR REPLACE INTO drafts VALUES (?, ?, ?)').run(id, token, JSON.stringify(change));
    return showDraft(id, change, token);
  }
  function showRequest(id, number) {
    const row = db.prepare('SELECT * FROM appointments WHERE id=?').get(number);
    if (!row) return send(id, 'Заявка не найдена.');
    const data = JSON.parse(row.body);
    const details = shareDetails ? `\n${data.name}\n${data.phone}\n${data.email}\n${data.service}\n${data.when.replace('T', ' ')} МСК\n${data.comment}` : '';
    return send(id, `Заявка №${row.id} · ${stages[row.status]}${details}`,
      [...stages.map((stage, index) => [key(stage, `status:${row.id}:${index}`)]), [key('К списку', 'requests')]]);
  }
  async function handle(update) {
    const callback = update.callback_query;
    const message = callback?.message || update.message;
    const id = String(callback?.from?.id ?? message?.from?.id ?? '');
    if (!allowed.has(id) || message?.chat?.type !== 'private' || String(message.chat.id) !== id) return false;
    if (callback) await transport.ack?.(callback.id);
    const action = callback?.data;
    const input = typeof message.text === 'string' ? message.text.trim() : '';
    if (!action && ['/start', '/menu', '/cancel'].includes(input)) {
      waiting.delete(id);
      await send(id, 'Управление сайтом и заявками');
      return true;
    }
    if (!action) {
      const pending = waiting.get(id);
      if (!pending) { await send(id, 'Выберите действие.'); return true; }
      const [first, ...rest] = input.split(/\r?\n/);
      const description = rest.join('\n').trim();
      let change;
      if (pending.kind === 'contacts' && isPhone(first) && isEmail(description)) {
        change = { kind: 'contacts', phone: first, email: description };
      }
      if (pending.kind === 'intro' && input && input.length <= 180) change = { kind: 'intro', text: input };
      if ((pending.kind === 'add' || pending.kind === 'edit') && first && first.length <= 70 &&
          description && description.length <= 300) change = { ...pending, service: { title: first, description } };
      if (!change) { await send(id, 'Проверьте формат и повторите ввод. /cancel — отмена.'); return true; }
      waiting.delete(id);
      await draft(id, change);
      return true;
    }
    waiting.delete(id);
    const [command, arg, extra] = action.split(':');
    const service = content().services.find(item => item.id === arg);
    if (command === 'services') {
      const rows = content().services.map(item => [key((item.visible ? '● ' : '○ ') + item.title.slice(0, 55), 'service:' + item.id)]);
      await send(id, 'Услуги', [...rows, [key('Добавить услугу', 'add'), key('Меню', 'home')]]);
    } else if (command === 'service' && service) {
      await send(id, `${service.title}\n${service.description}`, [[key('Изменить', 'edit:' + arg)],
        [key(service.visible ? 'Скрыть' : 'Показать', 'visibility:' + arg), key('Удалить', 'delete:' + arg)],
        [key('К списку', 'services')]]);
    } else if (command === 'add' || (command === 'edit' && service) || ['contacts', 'intro'].includes(command)) {
      if (command === 'add' && content().services.length >= 30) { await send(id, 'Можно сохранить до 30 услуг.'); return true; }
      waiting.set(id, { kind: command, id: arg });
      await send(id, command === 'contacts' ? 'Введите телефон и email на отдельных строках.'
        : command === 'intro' ? 'Введите текст до 180 символов.'
        : 'Введите название (до 70 символов), затем описание (до 300 символов) с новой строки.');
    } else if (['visibility', 'delete'].includes(command) && service) {
      await draft(id, { kind: command, id: arg, title: service.title, visible: !service.visible });
    } else if (command === 'draft') {
      const saved = db.prepare('SELECT token,body FROM drafts WHERE owner=?').get(id);
      await showDraft(id, saved && JSON.parse(saved.body), saved?.token);
    } else if (command === 'ok') {
      await send(id, applyDraft(id, arg) ? 'Изменение опубликовано.' : 'Этот черновик уже недоступен.');
    } else if (command === 'no') {
      db.prepare('DELETE FROM drafts WHERE owner=? AND token=?').run(id, arg);
      await send(id, 'Черновик отменён.');
    } else if (command === 'requests') {
      const offset = Math.max(0, Number(arg) || 0);
      const rows = db.prepare('SELECT id,status FROM appointments ORDER BY id DESC LIMIT 11 OFFSET ?').all(offset);
      const pagination = [];
      if (offset) pagination.push(key('← Новее', 'requests:' + Math.max(0, offset - 10)));
      if (rows.length > 10) pagination.push(key('Старше →', 'requests:' + (offset + 10)));
      await send(id, rows.length ? 'Заявки' : 'Заявок пока нет.', [
        ...rows.slice(0, 10).map(row => [key(`№${row.id} · ${stages[row.status]}`, 'request:' + row.id)]),
        ...(pagination.length ? [pagination] : []), [key('Меню', 'home')]
      ]);
    } else if (command === 'request') {
      await showRequest(id, Number(arg));
    } else if (command === 'status' && /^[0-3]$/.test(extra)) {
      db.prepare('UPDATE appointments SET status=? WHERE id=?').run(Number(extra), Number(arg));
      await showRequest(id, Number(arg));
    } else {
      await send(id, 'Управление сайтом и заявками');
    }
    return true;
  }

  async function notify() {
    const pending = db.prepare('SELECT id FROM appointments WHERE notified=0 ORDER BY id LIMIT 20').all();
    for (const { id } of pending) {
      await send(owners[0], `Новая заявка №${id}`, [[key('Открыть заявку', 'request:' + id)]]);
      db.prepare('UPDATE appointments SET notified=1 WHERE id=?').run(id);
    }
  }
  return { handle, notify };
}

export function telegram(token) {
  async function call(method, data, timeout = 10000) {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data), signal: AbortSignal.timeout(timeout)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error('Telegram API unavailable');
    return result.result;
  }
  return {
    send: (chat_id, text, reply_markup) => call('sendMessage', {
      chat_id, text, reply_markup, link_preview_options: { is_disabled: true }
    }),
    ack: callback_query_id => call('answerCallbackQuery', { callback_query_id }).catch(() => {}),
    updates: offset => call('getUpdates', { offset, timeout: 20, allowed_updates: ['message', 'callback_query'] }, 27000)
  };
}
