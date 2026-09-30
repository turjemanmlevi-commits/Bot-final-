import { allowedCommands, COMMAND_LABEL, type CommandResult, type OperationCommand, type OperationSummary } from '@to/shared';
import { Api } from '../lib/api';
import { eurosEs, parseEuros } from '../lib/format';
import { useAction, useToast } from '../lib/hooks';
import { useDialog } from './Dialog';
import { Icon, type IconName } from './Icon';

const ICONS: Partial<Record<OperationCommand, IconName>> = {
  validate: 'check',
  arm: 'lock',
  disarm: 'refresh',
  readiness: 'shield',
  'start-now': 'play',
  pause: 'pause',
  resume: 'play',
  stop: 'stop',
  cancel: 'x',
  'reduce-qty': 'down',
  'lower-max-price': 'down',
  close: 'check',
};

const PRIMARY: OperationCommand[] = ['validate', 'arm', 'resume', 'close'];

/** Qué ha pasado, en un aviso: el resultado de la comprobación previa se ve aunque se esté en «En directo». */
function doneText(command: OperationCommand, r: CommandResult): string {
  if (command !== 'readiness' || !r.readiness) return r.message;
  const { overall, checks } = r.readiness;
  const bad = checks.filter((c) => c.status === overall).map((c) => c.label);
  if (overall === 'PASS') return 'Comprobación previa: todo listo.';
  return `Comprobación previa: ${overall === 'FAIL' ? 'falla' : 'con avisos'} (${bad.join(', ')}). El detalle, en «Preparación».`;
}
const DANGER: OperationCommand[] = ['stop', 'cancel'];

/** Botones de comando: solo los que acepta el estado actual (misma regla que el servidor). */
export function OperationActions({
  op,
  maxUnitPrice,
  only,
  size = 'md',
  onDone,
}: {
  op: OperationSummary;
  maxUnitPrice?: number;
  only?: OperationCommand[];
  size?: 'sm' | 'md';
  onDone?: () => void;
}) {
  const { run, busy } = useAction();
  const toast = useToast();
  const ask = useDialog();
  const commands = allowedCommands(op.state).filter((c) => (only ? only.includes(c) : true));

  const exec = async (command: OperationCommand) => {
    let value: number | undefined;
    let reason: string | undefined;
    if (command === 'reduce-qty') {
      const v = await ask({
        title: 'Reducir cantidad',
        body: `Ahora se piden ${op.requestedQty} entradas (${op.cartedQty} ya en carrito). Solo se puede bajar.`,
        input: { label: 'Nueva cantidad', type: 'number', defaultValue: String(Math.max(op.cartedQty, op.requestedQty - 1)) },
        confirmText: 'Reducir',
      });
      if (typeof v !== 'string') return;
      value = Math.trunc(Number(v));
    } else if (command === 'lower-max-price') {
      const v = await ask({
        title: 'Bajar el precio máximo',
        body: 'Precio por entrada, con gastos. Solo se puede bajar mientras la operación está armada o en marcha.',
        input: { label: `Nuevo máximo (${op.currency}, p. ej. 119,50)`, type: 'text', defaultValue: maxUnitPrice ? eurosEs(maxUnitPrice) : '' },
        confirmText: 'Bajar precio',
      });
      if (typeof v !== 'string') return;
      value = parseEuros(v) ?? undefined;
    } else if (command === 'stop' || command === 'cancel') {
      const v = await ask({
        title: command === 'stop' ? '¿Parar la operación?' : '¿Cancelar la operación?',
        body:
          command === 'stop'
            ? 'Se detiene la automatización. Los carritos conseguidos se mantienen: págalos o libéralos tú.'
            : 'La operación se cancela y las cuentas quedan libres. Los carritos existentes no se tocan.',
        input: { label: 'Motivo (opcional)', defaultValue: '' },
        confirmText: command === 'stop' ? 'Parar' : 'Cancelar operación',
        danger: true,
      });
      if (v === null || v === false) return;
      reason = typeof v === 'string' && v.trim() ? v.trim() : undefined;
    } else if (command === 'arm') {
      const ok = await ask({
        title: 'Armar la operación',
        body: 'Se congela la configuración (snapshot con hash), se reservan las cuentas y se abren sesiones. A partir de aquí solo se puede reducir cantidad o bajar precio.',
        confirmText: 'Armar',
      });
      if (!ok) return;
    }
    let r = await run(() => Api.command(op.id, { command, value, reason }));
    // Cerrar con carritos por pagar: el servidor pide confirmación explícita.
    if (r && !r.ok && r.needsConfirm) {
      const sure = await ask({ title: '¿Cerrar con carritos por pagar?', body: r.message, confirmText: 'Cerrar igualmente', danger: true });
      if (!sure) return;
      r = await run(() => Api.command(op.id, { command, value, reason, confirm: true }));
    }
    if (r) {
      if (r.ok) toast(doneText(command, r), command === 'readiness' && r.readiness?.overall === 'FAIL' ? 'error' : 'info');
      else {
        const issues = r.validation?.issues.filter((i) => i.severity === 'ERROR').map((i) => `• ${i.message}`) ?? [];
        await ask({ title: r.message, body: issues.length ? <div style={{ whiteSpace: 'pre-line' }}>{issues.join('\n')}</div> : undefined, confirmText: 'Entendido' });
      }
      onDone?.();
    }
  };

  if (commands.length === 0) return null;
  return (
    <div className="row">
      {commands.map((c) => (
        <button
          key={c}
          type="button"
          className={`btn ${size === 'sm' ? 'sm' : ''} ${PRIMARY.includes(c) ? 'primary' : ''} ${DANGER.includes(c) ? 'danger' : ''}`}
          disabled={busy}
          onClick={() => void exec(c)}
        >
          {ICONS[c] ? <Icon name={ICONS[c] as IconName} size={14} /> : null}
          {COMMAND_LABEL[c]}
        </button>
      ))}
    </div>
  );
}
