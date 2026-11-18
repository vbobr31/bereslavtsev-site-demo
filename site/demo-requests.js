const key = 'bereslavtsev-demo-requests-v1';

export function readDemoRequests() {
  const data = JSON.parse(localStorage.getItem(key) ?? '[]');
  return Array.isArray(data) ? data : [];
}

export function writeDemoRequests(requests) {
  localStorage.setItem(key, JSON.stringify(requests));
}
