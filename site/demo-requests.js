export const requestsKey = 'bereslavtsev-demo-requests-v1';

export function readDemoRequests() {
  const data = JSON.parse(localStorage.getItem(requestsKey) ?? '[]');
  return Array.isArray(data) ? data : [];
}

export function writeDemoRequests(requests) {
  localStorage.setItem(requestsKey, JSON.stringify(requests));
}
