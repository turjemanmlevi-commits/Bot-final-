/**
 * Cliente mínimo de la Bot API de Telegram (sin dependencias): enviar mensajes con botones
 * y recibir las pulsaciones por long-polling. Pensado para uso local: no usa webhooks.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type Button = { text: string; url: string } | { text: string; callback_data: string };
export type Keyboard = Button[][];

export interface CallbackPress {
  id: string;
  data: string;
  chatId: string | null;
  messageId: number | null;
  from: string;
}

export class TelegramError extends Error {
  constructor(
    readonly method: string,
    readonly description: string,
  ) {
    super(`Telegram ${method}: ${description}`);
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Telegram rechaza botones con URL a localhost/IP privada (BUTTON_URL_INVALID). */
export function isTelegramButtonUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    return !/^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/.test(u.hostname);
  } catch {
    return false;
  }
}

export class TelegramClient {
  private offset = 0;

  constructor(
    private readonly token: string,
    readonly chatId: string,
    private readonly apiBase = 'https://api.telegram.org',
  ) {}

  private async call<T>(method: string, body: Record<string, unknown> | FormData, signal?: AbortSignal): Promise<T> {
    const isForm = body instanceof FormData;
    const res = await fetch(`${this.apiBase}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: isForm ? undefined : { 'content-type': 'application/json' },
      body: isForm ? body : JSON.stringify(body),
      signal: signal ?? null,
    });
    const json = (await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))) as {
      ok: boolean;
      result?: T;
      description?: string;
    };
    if (!json.ok) throw new TelegramError(method, json.description ?? `HTTP ${res.status}`);
    return json.result as T;
  }

  /** Comprueba el token. Devuelve el @usuario del bot. */
  async whoAmI(): Promise<string> {
    const me = await this.call<{ username: string }>('getMe', {});
    return me.username;
  }

  async sendMessage(html: string, keyboard?: Keyboard): Promise<number> {
    const msg = await this.call<{ message_id: number }>('sendMessage', {
      chat_id: this.chatId,
      text: html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
    return msg.message_id;
  }

  /** Envía una captura con pie de foto. Si la foto falla, cae a un mensaje de texto. */
  async sendPhoto(file: string, captionHtml: string, keyboard?: Keyboard): Promise<number> {
    try {
      const form = new FormData();
      form.set('chat_id', this.chatId);
      form.set('caption', captionHtml);
      form.set('parse_mode', 'HTML');
      if (keyboard) form.set('reply_markup', JSON.stringify({ inline_keyboard: keyboard }));
      form.set('photo', new Blob([await readFile(file)], { type: 'image/png' }), path.basename(file));
      const msg = await this.call<{ message_id: number }>('sendPhoto', form);
      return msg.message_id;
    } catch (err) {
      if (err instanceof TelegramError && /caption is too long/i.test(err.description)) {
        return this.sendMessage(captionHtml, keyboard);
      }
      throw err;
    }
  }

  async answerCallback(id: string, text: string): Promise<void> {
    await this.call('answerCallbackQuery', { callback_query_id: id, text }).catch(() => undefined);
  }

  async clearButtons(messageId: number): Promise<void> {
    await this.call('editMessageReplyMarkup', {
      chat_id: this.chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
    }).catch(() => undefined);
  }

  /** Descarta las pulsaciones antiguas para no reaccionar a botones de pruebas anteriores. */
  async skipPendingUpdates(): Promise<void> {
    const updates = await this.call<Array<{ update_id: number }>>('getUpdates', { offset: -1, timeout: 0 });
    const last = updates.at(-1);
    if (last) this.offset = last.update_id + 1;
  }

  /** Long-polling de pulsaciones de botones hasta que se aborte `signal`. */
  async pollCallbacks(onPress: (press: CallbackPress) => void | Promise<void>, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      let updates: Array<{
        update_id: number;
        callback_query?: {
          id: string;
          data?: string;
          from?: { username?: string; first_name?: string };
          message?: { message_id: number; chat: { id: number } };
        };
      }>;
      try {
        updates = await this.call('getUpdates', { offset: this.offset, timeout: 25, allowed_updates: ['callback_query'] }, signal);
      } catch (err) {
        if (signal.aborted) return;
        // Error de red transitorio: reintenta sin tumbar la prueba.
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      for (const u of updates) {
        this.offset = u.update_id + 1;
        const cq = u.callback_query;
        if (!cq?.data) continue;
        const chatId = cq.message ? String(cq.message.chat.id) : null;
        // Solo aceptamos pulsaciones desde tu chat.
        if (chatId !== this.chatId) continue;
        await onPress({
          id: cq.id,
          data: cq.data,
          chatId,
          messageId: cq.message?.message_id ?? null,
          from: cq.from?.username ?? cq.from?.first_name ?? 'desconocido',
        });
      }
    }
  }
}
