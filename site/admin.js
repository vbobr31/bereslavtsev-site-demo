import { mode } from './config.js';
import { readDemoRequests, writeDemoRequests } from './demo-requests.js';

const list = document.querySelector('#requests');
const message = document.querySelector('#admin-status');
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
  try { render(); } catch { message.textContent = 'Хранилище браузера недоступно.'; }
} else {
  message.textContent = 'Демо-панель доступна в статической версии сайта.';
}
