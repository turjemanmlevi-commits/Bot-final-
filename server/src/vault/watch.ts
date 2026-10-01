import { watch, type FSWatcher } from 'node:fs';
import { log } from '../util/log';

/**
 * Vigila el vault y avisa (con rebote) cuando cambia alguna nota. Ignora la
 * carpeta .obsidian: Obsidian reescribe workspace.json cada vez que haces clic.
 */
export function watchVault(dir: string, onChange: () => void, debounceMs = 400): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const trigger = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, debounceMs);
  };
  let watcher: FSWatcher;
  try {
    watcher = watch(dir, { recursive: true }, (_event, filename) => {
      if (!filename) return trigger();
      const f = filename.toString().replace(/\\/g, '/');
      if (f.startsWith('.') || f.includes('/.')) return;
      if (f.toLowerCase().endsWith('.md') || !/\.[a-z0-9]+$/i.test(f)) trigger();
    });
  } catch (err) {
    log.warn('No se puede vigilar el vault: recompila a mano desde el dashboard', { error: (err as Error).message });
    return () => undefined;
  }
  watcher.on('error', (err) => log.warn('Error vigilando el vault', { error: err.message }));
  return () => {
    watcher.close();
    if (timer) clearTimeout(timer);
  };
}
