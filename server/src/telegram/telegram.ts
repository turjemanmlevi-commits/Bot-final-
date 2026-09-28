/**
 * Telegram (opcional). Envía alertas importantes y tareas humanas con botones,
 * y acepta comandos básicos. Solo escucha al chat configurado y a los chats de
 * las cuentas (telegramChatId). Se activa con TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID.
 */

import type { Alert, HumanTask } from '@to/shared';
import { formatMoney, OPERATION_STATE_LABEL } from '@to/shared';
import type { Notifier } from '../runtime/context';
import type { Runtime } from '../runtime/runtime';
import { log } from '../util/log';

interface TgUpdate {
  update_id: number;
  message?: { chat: { id: number }; text?: string; from?: { username?: string; id: number } };
  callback_query?: { id: string; data?: string; from: { username?: string; id: number }; message?: { chat: { id: number }; message_id: number } };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ICON: Record<Alert['severity'], string> = { INFO: 'ℹ️', WARNING: '⚠️', CRITICAL: '🚨' };
const ALWAYS_SEND = new Set<Alert['kind']>(['CART_SECURED', 'CART_CONFIRMED']);

export class TelegramNotifier implements Notifier {
  readonly enabled = true;
  connected = false;
  detail = 'Conectando…';
  private runtime: Runtime | null = null;
  private offset = 0;
  private stopped = false;

  constructor(
    private readonly token: string,
    private readonly chatId: string,
  ) {}

  attach(runtime: Runtime): void {
    this.runtime = runtime;
    void this.check();
    void this.poll();
  }

  stop(): void {
    this.stopped = true;
  }

  private async api<T>(method: string, body: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = (await res.json()) as { ok: boolean; result: T; description?: string };
    if (!json.ok) throw new Error(json.description ?? `Telegram ${method} falló`);
    return json.result;
  }

  private async check(): Promise<void> {
    try {
      const me = await this.api<{ username: string }>('getMe', {});
      this.connected = true;
      this.detail = `@${me.username}`;
    } catch (err) {
      this.connected = false;
      this.detail = `Sin conexión: ${(err as Error).message}`;
    }
  }

  private send(chatId: string, text: string, keyboard?: Array<Array<{ text: string; callback_data: string }>>): void {
    void this.api('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    }).catch((err: Error) => {
      this.connected = false;
      this.detail = `Error enviando: ${err.message}`;
      log.warn('Telegram: no se pudo enviar', { error: err.message });
    });
  }

  private chatsFor(accountId: string | null): string[] {
    const chats = new Set([this.chatId]);
    const personal = accountId ? this.runtime?.store.accounts.get(accountId)?.telegramChatId : null;
    if (personal) chats.add(personal);
    return [...chats];
  }

  notifyAlert(alert: Alert): void {
    if (alert.severity === 'INFO' && !ALWAYS_SEND.has(alert.kind)) return;
    if (alert.kind === 'HUMAN_TASK') return; // la tarea llega con sus propios botones
    const text = `${ICON[alert.severity]} <b>${esc(alert.title)}</b>\n${esc(alert.message)}`;
    for (const chat of this.chatsFor(alert.accountId)) this.send(chat, text);
  }

  notifyTask(task: HumanTask): void {
    const account = this.runtime?.store.accounts.get(task.accountId);
    const target = task.target ? `\n🎯 ${task.target.qty} × ${esc(task.target.sectionLabel)} · máx. ${formatMoney(task.target.maxUnitPrice, task.target.currency)}` : '';
    const text = `🧑 <b>${esc(task.title)}</b>\nCuenta: ${esc(account?.label ?? task.accountId)}${target}\n\n${esc(task.instructions)}`;
    const keyboard =
      task.kind === 'OPEN_SESSION'
        ? [[{ text: '✅ Sesión lista', callback_data: `t:${task.id}:READY` }]]
        : [
            [{ text: '✅ En carrito', callback_data: `t:${task.id}:IN_CART` }],
            [
              { text: '❌ No pude', callback_data: `t:${task.id}:FAILED` },
              { text: '❓ No sé', callback_data: `t:${task.id}:UNKNOWN` },
            ],
          ];
    for (const chat of this.chatsFor(task.accountId)) this.send(chat, text, keyboard);
  }

  private allowedChats(): Set<string> {
    const s = new Set([this.chatId]);
    for (const a of this.runtime?.store.accounts.values() ?? []) if (a.telegramChatId) s.add(a.telegramChatId);
    return s;
  }

  private async poll(): Promise<void> {
    while (!this.stopped) {
      try {
        const updates = await this.api<TgUpdate[]>('getUpdates', { offset: this.offset, timeout: 25, allowed_updates: ['message', 'callback_query'] }, 35_000);
        this.connected = true;
        for (const u of updates) {
          this.offset = Math.max(this.offset, u.update_id + 1);
          await this.handle(u).catch((err: Error) => log.warn('Telegram: error procesando', { error: err.message }));
        }
      } catch (err) {
        this.connected = false;
        this.detail = `Sin conexión: ${(err as Error).message}`;
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  private async handle(u: TgUpdate): Promise<void> {
    const rt = this.runtime;
    if (!rt) return;
    const allowed = this.allowedChats();
    if (u.callback_query) {
      const q = u.callback_query;
      const chat = String(q.message?.chat.id ?? '');
      if (!allowed.has(chat)) return;
      const [kind, taskId, result] = (q.data ?? '').split(':');
      if (kind !== 't' || !taskId || !result) return;
      const task = rt.store.humanTasks.get(taskId);
      const actor = `telegram:${q.from.username ?? q.from.id}`;
      let text = 'Hecho';
      try {
        if (result === 'IN_CART') {
          rt.ctx.tasks.respond(taskId, { result: 'IN_CART', qty: task?.target?.qty ?? 1, unitPrice: task?.target?.maxUnitPrice ?? 1, note: 'Confirmado por Telegram: cantidad y precio asumidos (revisa en el dashboard)' }, actor);
        } else if (result === 'READY' || result === 'FAILED' || result === 'UNKNOWN') {
          rt.ctx.tasks.respond(taskId, { result }, actor);
        }
      } catch (err) {
        text = (err as Error).message;
      }
      await this.api('answerCallbackQuery', { callback_query_id: q.id, text }).catch(() => undefined);
      if (q.message) await this.api('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
      return;
    }
    const m = u.message;
    if (!m?.text) return;
    const chat = String(m.chat.id);
    if (!allowed.has(chat)) return;
    const cmd = m.text.trim().split(/\s+/)[0]?.toLowerCase().replace(/@.*$/, '');
    const main = chat === this.chatId;
    if (cmd === '/estado') {
      const ops = rt.ctx.ops.summaries().filter((o) => !['CLOSED', 'CANCELLED'].includes(o.state));
      const lines = ops.map((o) => `• <b>${esc(o.name)}</b>: ${OPERATION_STATE_LABEL[o.state]} · ${o.cartedQty}/${o.requestedQty}`);
      this.send(chat, lines.length ? lines.join('\n') : 'No hay operaciones activas.');
    } else if (cmd === '/tareas') {
      const tasks = [...rt.store.humanTasks.values()].filter((t) => t.state === 'OPEN');
      this.send(chat, tasks.length ? tasks.map((t) => `• ${esc(t.title)}`).join('\n') : 'No hay tareas abiertas.');
      for (const t of tasks) this.notifyTask(t);
    } else if (cmd === '/pausa' && main) {
      for (const o of rt.ctx.ops.summaries()) if (o.state === 'RUNNING') await rt.ctx.ops.command(o.id, { command: 'pause', reason: 'Telegram' }, 'telegram');
      this.send(chat, 'Operaciones en marcha pausadas.');
    } else if (cmd === '/parar_todo' && main) {
      rt.ctx.safety.setKillSwitch('GLOBAL', null, true, 'Telegram /parar_todo', 'telegram');
      this.send(chat, '🛑 Kill switch GLOBAL activado. Suéltalo desde el dashboard (Seguridad).');
    } else if (cmd === '/ayuda' || cmd === '/start') {
      this.send(chat, '/estado — operaciones activas\n/tareas — tareas humanas abiertas\n/pausa — pausa todo lo que está en marcha\n/parar_todo — kill switch global');
    }
  }
}
