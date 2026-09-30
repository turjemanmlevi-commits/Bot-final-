import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('./fixture.html', import.meta.url));
const server = createServer((request, response) => {
  const path = new URL(request.url || '/', 'http://127.0.0.1:8879').pathname;
  if (request.method !== 'GET' || path !== '/fixture') {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Solo existe la página de prueba /fixture.');
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end(html);
});
server.listen(8879, '127.0.0.1', () => {
  console.log('Simulación local, sin reservas reales: http://127.0.0.1:8879/fixture?eventRef=fixture-event');
});
