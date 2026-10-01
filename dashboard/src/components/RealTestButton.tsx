import { useNavigate } from 'react-router';
import { BROWSER_TEST_QUICK } from '@to/shared';
import { Api } from '../lib/api';
import { useAction } from '../lib/hooks';
import { useLive } from '../lib/store';
import { useDialog } from './Dialog';
import { Icon } from './Icon';

/**
 * «Prueba Real Madrid»: el bot abre su propio Chrome con una cuenta de «Cuentas», entra en la
 * web de entradas del Real Madrid (femenino), mete las entradas en el carrito, pulsa «Comprar
 * entradas» y, con la pantalla de pago abierta, avisa por Telegram con la captura y los botones.
 * Nunca paga. Los requisitos los pone el bot (3 seguidas, cualquier zona, sin tope; si no hay, menos).
 */
export function RealTestButton({ className = 'btn', size = 15 }: { className?: string; size?: number }) {
  const ask = useDialog();
  const navigate = useNavigate();
  const s = useLive();
  const { run, busy } = useAction();

  const start = async () => {
    const accounts = Object.values(s.accounts)
      .filter((a) => a.enabled)
      .sort((a, b) => Number(b.providerId === 'real-madrid') - Number(a.providerId === 'real-madrid') || a.label.localeCompare(b.label, 'es'));
    if (accounts.length === 0) {
      await ask({
        title: 'Falta una cuenta',
        body: 'Crea tu cuenta del Real Madrid en «Cuentas» (proveedor Real Madrid) y vuelve a pulsar.',
        confirmText: 'Entendido',
      });
      navigate('/cuentas');
      return;
    }
    const q = BROWSER_TEST_QUICK;
    const chosen = await ask({
      title: 'Prueba real: el bot mete las entradas al carrito',
      body: (
        <div className="stack" style={{ gap: 8 }}>
          <div>
            El bot abre <b>su propio Chrome</b> con la cuenta elegida, entra en <b>tickets.realmadrid.com</b> (femenino), elige el próximo partido a la venta y mete{' '}
            <b>
              {q.quantity} entradas{q.contiguous ? ' seguidas' : ''}
            </b>{' '}
            en el carrito (cualquier zona, sin tope de precio; si no hay {q.quantity}, las que haya).
          </div>
          <div>
            Pulsa <b>«Comprar entradas»</b> y, con la pantalla de pago abierta, te manda por Telegram la <b>captura</b>, el <b>enlace</b> y los botones{' '}
            <b>✅ Sí, voy a pagar</b> / <b>❌ No, liberar</b>. Aquí abajo lo ves en vivo.
          </div>
          <div className="small muted">
            Nunca paga. Si la web pide iniciar sesión, cola o verificación, te avisa y lo haces tú en su ventana (queda guardado para la siguiente).
          </div>
        </div>
      ),
      input: {
        label: 'Con qué cuenta entra el bot',
        options: accounts.map((a) => ({ value: a.id, label: `${a.label}${a.providerId === 'real-madrid' ? '' : ` · ${a.providerId}`}` })),
        defaultValue: accounts[0]?.id ?? '',
        hint: 'Mejor una cuenta que ya haya iniciado sesión en «Cuentas → Abrir navegador».',
      },
      confirmText: 'Empezar la prueba',
    });
    if (typeof chosen !== 'string' || !chosen) return;
    const r = await run(() => Api.browserTestStart({ ...q, accountId: chosen }), 'Prueba en marcha: mira la tarjeta «Prueba real con el navegador»');
    if (r) {
      navigate('/');
      setTimeout(() => document.getElementById('prueba-navegador')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 150);
    }
  };

  return (
    <button type="button" className={className} onClick={() => void start()} disabled={busy}>
      <Icon name="play" size={size} /> Prueba Real Madrid
    </button>
  );
}
