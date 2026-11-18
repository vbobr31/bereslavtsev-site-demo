import { mode } from './config.js';

if (mode !== 'demo') {
  try {
    const response = await fetch('./api/content', { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Contacts unavailable');
    const { phone, email } = await response.json();
    const phoneLink = document.querySelector('#phone');
    phoneLink.textContent = phone;
    phoneLink.href = 'tel:' + phone.replace(/[^+\d]/g, '');
    const emailLink = document.querySelector('#email');
    emailLink.textContent = email;
    emailLink.href = 'mailto:' + email;
    document.querySelector('#contact-note').hidden = true;
  } catch {
    // Keep the contact details rendered on the page.
  }
}
