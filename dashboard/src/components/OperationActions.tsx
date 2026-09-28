import { allowedCommands, COMMAND_LABEL, type OperationCommand, type OperationSummary } from '@to/shared';
import { Api } from '../lib/api';
import { euros, parseEuros } from '../lib/format';
import { useAction } from '../lib/hooks';
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
        input: { label: `Nuevo máximo (${op.currency})`, type: 'number', defaultValue: maxUnitPrice ? euros(maxUnitPrice) : '' },
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
    const r = await run(() => Api.command(op.id, { command, value, reason }));
    if (r) {
      if (!r.ok) {
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
