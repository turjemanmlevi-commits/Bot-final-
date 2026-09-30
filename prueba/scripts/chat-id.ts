/**
 * Averigua tu TELEGRAM_CHAT_ID: escribe cualquier cosa a tu bot en Telegram y ejecuta
 *   npm run prueba:chat-id
 */
import { loadConfig } from '../src/config.js';

const cfg = loadConfig();
if (!cfg.telegram.token) {
  console.error('Falta TELEGRAM_BOT_TOKEN en prueba/.env (créalo con @BotFather).');
  process.exit(1);
}
const res = await fetch(`${cfg.telegram.apiBase}/bot${cfg.telegram.token}/getUpdates`);
const body = (await res.json()) as {
  ok: boolean;
  description?: string;
  result?: Array<{ message?: { chat: { id: number; type: string; username?: string; first_name?: string; title?: string } } }>;
};
if (!body.ok) {
  console.error(`Telegram: ${body.description ?? res.status}`);
  process.exit(1);
}
const chats = new Map<number, string>();
for (const u of body.result ?? []) {
  const c = u.message?.chat;
  if (c) chats.set(c.id, `${c.type} ${c.username ? '@' + c.username : c.title ?? c.first_name ?? ''}`.trim());
}
if (chats.size === 0) {
  console.log('No hay mensajes recientes. Escribe «hola» a tu bot en Telegram y vuelve a ejecutar este comando.');
} else {
  for (const [id, who] of chats) console.log(`TELEGRAM_CHAT_ID=${id}    (${who})`);
}
