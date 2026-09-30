import { useNavigate } from 'react-router';
import { Api } from '../lib/api';
import { useAction } from '../lib/hooks';
import { useDialog } from './Dialog';
import { Icon } from './Icon';

/**
 * «Prueba Real Madrid»: con las cuentas del Real Madrid de «Cuentas», arma una
 * operación de prueba (1 entrada por cuenta) en un partido de prueba a la venta.
 * El plan llega al momento por Telegram y la tarea de compra a la hora elegida.
 */
export function RealTestButton({ className = 'btn', size = 15 }: { className?: string; size?: number }) {
  const ask = useDialog();
  const navigate = useNavigate();
  const { run, busy } = useAction();

  const start = async () => {
    const minutes = await ask({
      title: 'Prueba real con el Real Madrid',
      body: (
        <div className="stack" style={{ gap: 8 }}>
          <div>
            Usa <b>tus cuentas del Real Madrid</b> (las de «Cuentas») en un partido de prueba que esté a la venta: <b>1 entrada por cuenta</b>, máximo 60 € por entrada.
          </div>
          <div>
            Te llega <b>ahora</b> el plan por Telegram: entra en realmadrid.com con tu cuenta y pulsa <b>✅ Sesión lista</b>. A la hora te llega la tarea con la zona; añade la entrada al
            carrito en la web oficial y pulsa <b>✅ 1 en carrito</b> (o <b>❌ No pude</b>).
          </div>
          <div className="small muted">La sala no entra en la web ni paga: eso lo haces tú. Si no quieres la entrada, no pagues y pulsa «Liberar» en Carritos.</div>
        </div>
      ),
      input: { label: 'Minutos hasta que abra la venta de prueba', type: 'number', defaultValue: '2', hint: 'Entre 1 y 60. También puedes pulsar «Empezar ya» en la operación.' },
      confirmText: 'Armar la prueba',
    });
    if (typeof minutes !== 'string') return;
    const m = Math.min(60, Math.max(1, Math.round(Number(minutes.replace(',', '.')) || 2)));
    const r = await run(() => Api.realTest({ startInSeconds: m * 60 }), (x) => x.message);
    if (r) navigate(`/operaciones/${r.operationId}`);
  };

  return (
    <button type="button" className={className} onClick={() => void start()} disabled={busy}>
      <Icon name="send" size={size} /> Prueba Real Madrid
    </button>
  );
}
