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
import { existsSync } from 'node:fs';
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

/** Opciones de lanzamiento de Playwright para que la web vea un Chrome normal. */
export function launchOptionsFor(browser: SystemBrowser | null): { channel?: 'chrome' | 'msedge'; ignoreDefaultArgs: string[]; args: string[] } {
  return {
    ...(browser ? { channel: browser.channel } : {}),
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled', '--disable-background-mode', '--no-first-run', '--no-default-browser-check'],
  };
}

export interface LoginBrowser {
  pid: number | null;
  running(): boolean;
  /** Cierra la ventana con cuidado (para que Chrome guarde las cookies) y espera a que termine. */
  close(): Promise<void>;
}

/**
 * Abre el Chrome del PC como un proceso normal (sin automatización) con el perfil del bot, en la URL
 * dada, para que la persona inicie sesión. Devuelve el proceso para poder cerrarlo antes de una prueba.
 */
export function openLoginBrowser(browser: SystemBrowser, profileDir: string, url: string): LoginBrowser {
  const args = [
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-mode',
    '--disable-sync-preferences',
    '--window-size=1366,900',
    '--lang=es-ES',
    '--new-window',
    url,
  ];
  const child: ChildProcess = spawn(browser.executablePath, args, { stdio: 'ignore', windowsHide: false });
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });
  child.once('error', () => {
    exited = true;
  });
  const running = () => !exited && child.exitCode === null;
  const waitExit = (ms: number) =>
    new Promise<boolean>((resolve) => {
      if (!running()) return resolve(true);
      const t = setTimeout(() => resolve(!running()), ms);
      child.once('exit', () => {
        clearTimeout(t);
        resolve(true);
      });
    });
  return {
    pid: child.pid ?? null,
    running,
    close: async () => {
      if (!running()) return;
      if (process.platform === 'win32' && child.pid) {
        // Sin /F: Chrome recibe «cerrar ventana» y guarda el perfil antes de salir.
        await new Promise<void>((resolve) => {
          const k = spawn('taskkill', ['/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true });
          k.once('exit', () => resolve());
          k.once('error', () => resolve());
        });
      } else {
        child.kill('SIGTERM');
      }
      if (await waitExit(10_000)) return;
      if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      else child.kill('SIGKILL');
      await waitExit(3000);
    },
  };
}
