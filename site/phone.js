export function normalizePhone(value) {
  if (typeof value !== 'string' || value.length > 30) return null;
  const input = value.trim();
  if (!/^\+?[0-9][0-9 ().-]*$/.test(input)) return null;
  const digits = input.replace(/\D/g, '');

  let national;
  if (input.startsWith('+')) {
    if (!/^7\d{10}$/.test(digits)) return null;
    national = digits.slice(1);
  } else if (/^8\d{10}$/.test(digits)) {
    national = digits.slice(1);
  } else if (/^9\d{9}$/.test(digits)) {
    national = digits;
  }
  if (!national || !/^[3489]\d{9}$/.test(national) || /^(\d)\1{9}$/.test(national)) return null;
  return '+7' + national;
}
