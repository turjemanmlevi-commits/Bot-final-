/**
 * Navegador del bot: se prefiere el Google Chrome (o Edge) instalado en el PC, con un perfil
 * propio del bot por cuenta.
 *
 * Para iniciar sesión (Google, Apple o email) el Chrome se abre como un proceso normal, sin
 * automatización: así Google no lo rechaza («este navegador puede no ser seguro») y la sesión
 * queda en el perfil. En la prueba, Playwright abre ese mismo Chrome con ese mismo perfil (las
 * cookies de Chrome en Windows solo las lee el propio Chrome) y sin la bandera de automatización.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, openSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

export interface SystemBrowser {
  /** Canal de Playwright que corresponde al ejecutable. */
  channel: 'chrome' | 'msedge';
  executablePath: string;
  name: string;
}

function candidates(): Array<{ channel: SystemBrowser['channel']; name: string; paths: string[] }> {
  const env = process.env;
  const pf = env['ProgramFiles'] ?? 'C:\\Program Files';
  const pf86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const local = env['LOCALAPPDATA'] ?? '';
  if (process.platform === 'win32') {
    return [
      {
        channel: 'chrome',
        name: 'Google Chrome',
        paths: [path.join(pf, 'Google/Chrome/Application/chrome.exe'), path.join(pf86, 'Google/Chrome/Application/chrome.exe'), local ? path.join(local, 'Google/Chrome/Application/chrome.exe') : ''],
      },
      { channel: 'msedge', name: 'Microsoft Edge', paths: [path.join(pf86, 'Microsoft/Edge/Application/msedge.exe'), path.join(pf, 'Microsoft/Edge/Application/msedge.exe')] },
    ];
  }
  if (process.platform === 'darwin') {
    return [
      { channel: 'chrome', name: 'Google Chrome', paths: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] },
      { channel: 'msedge', name: 'Microsoft Edge', paths: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'] },
    ];
  }
  return [
    { channel: 'chrome', name: 'Google Chrome', paths: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome'] },
    { channel: 'msedge', name: 'Microsoft Edge', paths: ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'] },
  ];
}

/** Chrome o Edge instalados en este PC (null si no hay ninguno). Se puede forzar con BOT_BROWSER=ruta. */
export function findSystemBrowser(): SystemBrowser | null {
  const forced = process.env['BOT_BROWSER']?.trim();
  if (forced && existsSync(forced)) return { channel: /edge/i.test(forced) ? 'msedge' : 'chrome', executablePath: forced, name: path.basename(forced) };
  for (const c of candidates()) {
    const found = c.paths.find((p) => p && existsSync(p));
    if (found) return { channel: c.channel, executablePath: found, name: c.name };
  }
  return null;
}

/** ¿Hay algún navegador con el que el bot pueda trabajar (Chrome/Edge del PC o el Chromium de Playwright)? */
export function browserAvailable(): boolean {
  if (findSystemBrowser()) return true;
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

/**
 * Opciones de lanzamiento de Playwright para que la web vea un Chrome normal: el ejecutable del PC
 * (por ruta, así vale cualquier Chrome/Edge o el indicado en BOT_BROWSER) y sin la bandera de automatización.
 */
export function launchOptionsFor(browser: SystemBrowser | null, extraArgs: string[] = []): { executablePath?: string; ignoreDefaultArgs: string[]; args: string[] } {
  return {
    ...(browser ? { executablePath: browser.executablePath } : {}),
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled', '--disable-background-mode', '--no-first-run', '--no-default-browser-check', ...extraArgs],
  };
}

// ---------------------------------------------------------------------------
// ¿Hay un Chrome usando el perfil?
// ---------------------------------------------------------------------------

/**
 * true si algún Chrome tiene abierto el perfil `profileDir` (dos Chrome no pueden usar el mismo
 * perfil a la vez). Windows: Chrome mantiene bloqueado el archivo «lockfile». Linux/Mac: el enlace
 * «SingletonLock» apunta a «equipo-pid» y ese proceso sigue vivo.
 */
export function profileInUse(profileDir: string): boolean {
  if (process.platform === 'win32') {
    const lock = path.join(profileDir, 'lockfile');
    if (!existsSync(lock)) return false;
    try {
      const fd = openSync(lock, 'r+');
      closeSync(fd);
      return false;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
    }
  }
  const lock = path.join(profileDir, 'SingletonLock');
  let target: string;
  try {
    target = readlinkSync(lock);
  } catch {
    return false;
  }
  const pid = Number(/-(\d+)$/.exec(target)?.[1] ?? NaN);
  if (!Number.isFinite(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Espera a que ningún Chrome use el perfil. true si quedó libre antes de `timeoutMs`. */
export async function waitProfileFree(profileDir: string, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (profileInUse(profileDir)) {
    if (Date.now() > end || signal?.aborted) return false;
    await new Promise((r) => setTimeout(r, 400));
  }
  return true;
}

// ---------------------------------------------------------------------------
// Chrome normal (sin automatización) para iniciar sesión
// ---------------------------------------------------------------------------

export interface LoginBrowser {
  pid: number | null;
  /** true mientras haya un Chrome con el perfil abierto. */
  running(): boolean;
  /** Se resuelve cuando la persona cierra la ventana (el perfil queda libre) o se agota `timeoutMs`: true si se cerró. */
  waitClosed(timeoutMs: number, signal?: AbortSignal): Promise<boolean>;
  /** Cierra la ventana con cuidado (para que Chrome guarde las cookies) y espera a que el perfil quede libre. */
  close(): Promise<void>;
}

/**
 * Abre el Chrome del PC como un proceso normal (sin automatización, sin puerto de depuración) con el
 * perfil del bot, en las URL dadas, para que la persona inicie sesión: Google lo trata como un Chrome
 * cualquiera. Si ese perfil ya está abierto, Chrome solo abre las pestañas en esa ventana.
 */
export function openLoginBrowser(browser: SystemBrowser, profileDir: string, urls: string | string[], extraArgs: string[] = []): LoginBrowser {
  const list = Array.isArray(urls) ? urls : [urls];
  const args = [`--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', '--disable-background-mode', '--lang=es-ES', '--new-window', ...extraArgs, ...list];
  const child: ChildProcess = spawn(browser.executablePath, args, { stdio: 'ignore', windowsHide: false });
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });
  child.once('error', () => {
    exited = true;
  });
  const childAlive = () => !exited && child.exitCode === null;
  const running = () => childAlive() || profileInUse(profileDir);
  return {
    pid: child.pid ?? null,
    running,
    waitClosed: async (timeoutMs, signal) => {
      // Un instante para que Chrome cree su bloqueo (o entregue las pestañas al Chrome que ya tenía el perfil).
      await new Promise((r) => setTimeout(r, 1500));
      const end = Date.now() + timeoutMs;
      while (running()) {
        if (Date.now() > end || signal?.aborted) return false;
        await new Promise((r) => setTimeout(r, 500));
      }
      return true;
    },
    close: async () => {
      if (childAlive()) {
        if (process.platform === 'win32' && child.pid) {
          // Sin /F: Chrome recibe «cerrar ventana» y guarda el perfil antes de salir.
          await new Promise<void>((resolve) => {
            const k = spawn('taskkill', ['/PID', String(child.pid), '/T'], { stdio: 'ignore', windowsHide: true });
            k.once('exit', () => resolve());
            k.once('error', () => resolve());
          });
        } else {
          child.kill('SIGTERM');
        }
        if (!(await waitProfileFree(profileDir, 10_000))) {
          if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
          else child.kill('SIGKILL');
          await waitProfileFree(profileDir, 3000);
        }
      }
    },
  };
}
