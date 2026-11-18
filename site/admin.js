import { mode } from './config.js';
import { readDemoRequests, writeDemoRequests, requestsKey } from './demo-requests.js';

const list = document.querySelector('#requests');
const message = document.querySelector('#admin-status');
const count = document.querySelector('#request-count');
const emailForm = document.querySelector('#email-settings');
const emailStatus = document.querySelector('#email-status');
const preview = document.querySelector('#email-preview');
const recipientField = emailForm.elements.recipient;
const emailKey = 'bereslavtsev-demo-recipient-v1';
const statuses = { new: 'Новая', contacted: 'Связались', scheduled: 'Назначена', closed: 'Закрыта' };

function update(id, change) {
  try {
    const requests = readDemoRequests();
    writeDemoRequests(change ? requests.map(item => item.id === id ? { ...item, status: change } : item)
      : requests.filter(item => item.id !== id));
    render();
    message.textContent = change ? 'Статус обновлён.' : 'Тестовая заявка удалена.';
  } catch {
    message.textContent = 'Не удалось обновить запись.';
  }
}

function render() {
  const requests = readDemoRequests();
  const newCount = requests.filter(item => item.status === 'new').length;
  count.textContent = `Новые: ${newCount} · Всего: ${requests.length}`;
  const recipient = localStorage.getItem(emailKey);
  preview.hidden = !recipient || !newCount;
  if (!preview.hidden) preview.textContent = `Пример письма для ${recipient} — Новая заявка на консультацию. Откройте панель заявок.`;
  list.replaceChildren();
  if (!requests.length) {
    const empty = document.createElement('li');
    empty.textContent = 'Заявок пока нет.';
    list.append(empty);
    return;
  }
  for (const request of requests) {
    const row = document.createElement('li');
    const heading = document.createElement('h3');
    heading.textContent = request.name;
    const details = document.createElement('p');
    details.textContent = [request.service, request.phone, request.email, request.comment].filter(Boolean).join(' · ');
    const label = document.createElement('label');
    label.textContent = 'Статус';
    const select = document.createElement('select');
    for (const [value, title] of Object.entries(statuses)) select.add(new Option(title, value));
    select.value = request.status;
    select.addEventListener('change', () => update(request.id, select.value));
    label.append(select);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'button outline';
    remove.textContent = 'Удалить тестовую заявку';
    remove.addEventListener('click', () => update(request.id));
    row.append(heading, details, label, remove);
    list.append(row);
  }
}

if (mode === 'demo') {
  try {
    recipientField.value = localStorage.getItem(emailKey) || '';
    emailForm.querySelector('button').disabled = false;
    emailForm.addEventListener('submit', event => {
      event.preventDefault();
      try {
        localStorage.setItem(emailKey, recipientField.value.trim());
        emailStatus.textContent = 'Адрес сохранён в этом браузере. В демо письма не отправляются.';
        render();
      } catch { emailStatus.textContent = 'Браузер не разрешил сохранить адрес.'; }
    });
    window.addEventListener('storage', event => {
      if ([requestsKey, emailKey, null].includes(event.key)) {
        if (event.key !== requestsKey) recipientField.value = localStorage.getItem(emailKey) || '';
        render();
      }
    });
    render();
  } catch { message.textContent = 'Хранилище браузера недоступно.'; }
} else {
  message.textContent = 'Демо-панель доступна в статической версии сайта.';
}
