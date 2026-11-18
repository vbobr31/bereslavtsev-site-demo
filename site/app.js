import { mode, consentVersion } from './config.js';
import { normalizePhone } from './phone.js';
import { readDemoRequests, writeDemoRequests } from './demo-requests.js';

const form = document.querySelector('#appointment');
const status = document.querySelector('#form-status');
const submit = form.querySelector('button[type=submit]');
const booking = document.querySelector('#booking');
const nudge = document.querySelector('#nudge');
const service = form.elements.service;
const live = mode !== 'demo';
let submitted = false;
let requestKey = '';
let lastBody = '';
let shown = false;
try { shown = sessionStorage.getItem('consultation-reminder') === '1'; } catch {}

function closeReminder(restoreFocus = false) {
  nudge.hidden = true;
  if (restoreFocus) {
    const previous = closeReminder.previousFocus;
    if (previous?.isConnected && previous !== document.body) previous.focus();
    else booking.querySelector('h2').focus({ preventScroll: true });
  }
}
booking.querySelector('h2').tabIndex = -1;
function checkReminder() {
  const scrollLength = document.documentElement.scrollHeight - innerHeight;
  const rect = booking.getBoundingClientRect();
  const formVisible = rect.top < innerHeight && rect.bottom > 0;
  if (formVisible) closeReminder();
  if (shown || submitted || formVisible || form.contains(document.activeElement) ||
      performance.now() < 25000 || scrollLength <= 0 || scrollY / scrollLength < .4) return;
  shown = true;
  closeReminder.previousFocus = document.activeElement;
  try { sessionStorage.setItem('consultation-reminder', '1'); } catch {}
  nudge.hidden = false;
}
addEventListener('scroll', checkReminder, { passive: true });
setTimeout(checkReminder, 25100);
document.querySelector('#dismiss').addEventListener('click', () => closeReminder(true));
document.querySelector('#nudge-link').addEventListener('click', () => {
  closeReminder();
  form.elements.name.focus({ preventScroll: true });
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !nudge.hidden) closeReminder(nudge.contains(document.activeElement));
});
form.addEventListener('focusin', () => closeReminder());

function renderContent({ services, phone, email, intro }) {
  document.querySelector('#intro').textContent = intro;
  const phoneLink = document.querySelector('#phone');
  phoneLink.textContent = phone;
  phoneLink.href = 'tel:' + phone.replace(/[^+\d]/g, '');
  const emailLink = document.querySelector('#email');
  emailLink.textContent = email;
  emailLink.href = 'mailto:' + email;
  document.querySelector('#contact-note').hidden = true;
  service.replaceChildren();
  const list = document.querySelector('#service-list');
  list.replaceChildren();
  for (const { id, title, description } of services) {
    service.add(new Option(title, id));
    const article = document.createElement('article');
    const heading = document.createElement('h3');
    heading.textContent = title;
    const copy = document.createElement('p');
    copy.textContent = description;
    const link = document.createElement('a');
    link.href = '#booking';
    link.textContent = 'Записаться ↗';
    link.addEventListener('click', () => { service.value = id; });
    article.append(heading, copy, link);
    list.append(article);
  }
  if (!services.length) list.textContent = 'Список услуг обновляется.';
  submit.disabled = !services.length;
  if (!services.length) status.textContent = 'Онлайн-запись временно недоступна.';
}

if (!live) submit.disabled = false;
if (live) {
  document.querySelector('.demo-admin-link').hidden = true;
  document.querySelector('#form-note').textContent = mode === 'test'
    ? 'Тестовый режим. Используйте вымышленные данные.'
    : 'Укажите, как с вами связаться для согласования консультации.';
  for (const [field, value] of [['name', 'name'], ['phone', 'tel'], ['email', 'email']]) {
    if (mode === 'live') form.elements[field].autocomplete = value;
  }
  submit.firstChild.textContent = 'Отправить заявку ';
  submit.disabled = true;
  fetch('./api/content', { signal: AbortSignal.timeout(8000) })
    .then(response => {
      if (!response.ok) throw Error();
      return response.json();
    }).then(renderContent)
    .catch(() => { status.textContent = 'Сервис записи недоступен. Обновите страницу или воспользуйтесь контактами.'; });
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  data.phone = normalizePhone(data.phone);
  if (!data.phone) {
    status.textContent = 'Введите российский номер в формате +7…, 8… или 9… (10 цифр для мобильного без префикса).';
    form.elements.phone.focus();
    return;
  }
  if (!live) {
    try {
      const requests = readDemoRequests();
      if (requests.length >= 50) {
        status.textContent = 'В демо-панели уже 50 заявок. Удалите одну и повторите попытку.';
        return;
      }
      writeDemoRequests([{ ...data, id: crypto.randomUUID(), created: new Date().toISOString(),
        service: service.selectedOptions[0].textContent, status: 'new' }, ...requests]);
    } catch {
      status.textContent = 'Браузер не разрешил сохранить тестовую заявку.';
      return;
    }
    submitted = true;
    closeReminder();
    form.reset();
    const link = document.createElement('a');
    link.href = 'admin.html';
    link.textContent = 'Открыть демо-панель';
    status.replaceChildren('Тестовая заявка сохранена в этом браузере. ', link);
    return;
  }
  data.consent = form.elements.consent.checked;
  data.consentVersion = consentVersion;
  const body = JSON.stringify(data);
  if (body !== lastBody || !requestKey) requestKey = crypto.randomUUID();
  lastBody = body;
  submit.disabled = true;
  status.textContent = 'Отправляем заявку…';
  try {
    const response = await fetch('./api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey },
      body, signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      status.textContent = response.status < 500 && result.error ? result.error : 'Сервис недоступен. Повторите отправку позже.';
      return;
    }
    submitted = true;
    closeReminder();
    form.reset();
    requestKey = '';
    status.textContent = 'Заявка принята. С вами свяжутся, чтобы согласовать консультацию.';
  } catch {
    status.textContent = 'Связь с сервером прервалась. Повторите отправку, чтобы проверить результат.';
  } finally {
    submit.disabled = false;
  }
});
