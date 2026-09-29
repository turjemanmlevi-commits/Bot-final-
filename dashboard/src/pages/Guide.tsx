import { Link } from 'react-router';
import { Icon, type IconName } from '../components/Icon';
import { Callout, Card, Pill } from '../components/ui';
import { VenueMap } from '../components/VenueMap';
import { Api } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { useLive } from '../lib/store';

interface Step {
  n: number;
  when: string;
  who: 'Tú' | 'Cada persona' | 'El sistema';
  title: string;
  icon: IconName;
  text: string;
  link?: { to: string; label: string };
}

const STEPS: Step[] = [
  {
    n: 1,
    when: 'La víspera',
    who: 'Tú',
    title: 'Cuentas: una por persona que va a ir',
    icon: 'users',
    text: 'Cuentas → Nueva cuenta. Elige dónde compra (Real Madrid, Ticketmaster o entradas.com) y pon alias, nunca emails, teléfonos ni DNI. Si usa Telegram, que abra el bot y pulse «Iniciar»: asígnale su chat en Ajustes · Telegram y recibirá solo sus tareas.',
    link: { to: '/cuentas', label: 'Ir a Cuentas' },
  },
  {
    n: 2,
    when: 'La víspera',
    who: 'Tú',
    title: 'Evento: enlace oficial, hora de la venta y límites',
    icon: 'calendar',
    text: 'Eventos → Nuevo evento. Elige el recinto y dónde se vende: con las claves gratuitas de Ajustes · Fuentes de eventos salen los próximos eventos de Ticketmaster (o los partidos del estadio) y «Usar este evento» rellena el enlace, la fecha, la apertura de la venta y el límite oficial; «Vigilar desde: 2 días antes» avisa por Telegram si algo cambia. Si no sale (entradas.com, fase de socios del Real Madrid), escribe el enlace, la hora de apertura de tu fase (hora de Madrid) y los límites de las condiciones oficiales. Marca «He comprobado estos límites».',
    link: { to: '/eventos', label: 'Ir a Eventos' },
  },
  {
    n: 3,
    when: 'La víspera',
    who: 'Tú',
    title: 'Operación: cuántas, dónde y hasta qué precio',
    icon: 'ops',
    text: 'Operaciones → Nueva operación. Toca en el plano las zonas en orden de preferencia (salen numeradas 1, 2, 3…), pon las entradas, el máximo por entrada con gastos y las cuentas. «Crear y validar» y después «Armar».',
    link: { to: '/operaciones/nueva', label: 'Nueva operación' },
  },
  {
    n: 4,
    when: 'Al armar',
    who: 'El sistema',
    title: 'Cada persona recibe su plan',
    icon: 'send',
    text: 'En Tareas humanas y en Telegram: a qué hora abre la venta, a qué zonas irá en orden, cuántas entradas y el precio máximo. Así nadie pierde segundos pensando.',
  },
  {
    n: 5,
    when: '15–30 min antes',
    who: 'Cada persona',
    title: 'Iniciar sesión en la web oficial y pulsar «Sesión lista»',
    icon: 'user',
    text: 'Botón «Abrir la web oficial», iniciar sesión con su cuenta y pulsar «Sesión lista» (en el dashboard o en Telegram). Hay que pulsarlo en cada compra: al armar la operación se pide confirmarla de nuevo, aunque ya se hubiera pulsado antes. Si alguien llega tarde puede hacerlo después: la operación no se cancela.',
    link: { to: '/tareas', label: 'Ir a Tareas' },
  },
  {
    n: 6,
    when: 'T0 (en milisegundos)',
    who: 'El sistema',
    title: '«¡Abre la venta!» y la tarea de cada uno',
    icon: 'bolt',
    text: 'A la hora exacta llega a Telegram y al dashboard: «Añade 2 entradas · Lateral Este · Primer anfiteatro, máx. 120 €», con el plano y tu zona resaltada. Medido en el ensayo: 10–26 ms desde la apertura.',
  },
  {
    n: 7,
    when: 'En la cola',
    who: 'Cada persona',
    title: 'Entrar en la cola oficial y añadir al carrito',
    icon: 'cart',
    text: 'Cada uno pasa la cola virtual de la web como cualquier comprador, elige asientos en su zona sin pasar del precio máximo y los añade al carrito.',
  },
  {
    n: 8,
    when: 'Al momento',
    who: 'Cada persona',
    title: 'Responder: «2 en carrito» o «No pude»',
    icon: 'check',
    text: '«N en carrito» y los minutos que le quedan al carrito (un toque en Telegram). «No pude» si no hay entradas por ese precio: la siguiente zona llega al instante (medido: ~50 ms). El sistema reparte lo que falta y nunca supera los límites.',
  },
  {
    n: 9,
    when: 'Antes de que caduque',
    who: 'Cada persona',
    title: 'Pagar en la web oficial y marcarlo',
    icon: 'lock',
    text: 'Se paga siempre en la web oficial. Después: Carritos → «Ya lo he pagado». Hay avisos por Telegram a 5, 2 y 1 minutos de que caduque (si indicas los minutos que le quedan al carrito). Si se acaba el tiempo, el sistema no da las entradas por perdidas: pregunta «¿Lo has pagado?». Responde «Ya lo he pagado» o, si se perdieron, «Liberar» y esas entradas se vuelven a repartir.',
    link: { to: '/carritos', label: 'Ir a Carritos' },
  },
];

const WHO_TONE: Record<Step['who'], 'neutral' | 'good' | 'warning'> = { Tú: 'neutral', 'Cada persona': 'warning', 'El sistema': 'good' };

export function GuidePage() {
  const s = useLive();
  const bernabeu = Object.values(s.venues).find((v) => v.active && v.venueId === 'estadio-santiago-bernabeu' && v.eventId === null);
  const art = useAsync(() => (bernabeu ? Api.venue(bernabeu.hash) : Promise.resolve(null)), [bernabeu?.hash]);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>Cómo se compra</h1>
          <div className="sub">De preparar la víspera a pagar, paso a paso. Cada persona compra con su cuenta en la web oficial; el sistema coordina, reparte y avisa.</div>
        </div>
      </div>

      <Callout icon="info">
        <b>Lo que hace el sistema:</b> reparte quién va a por qué zona, cuántas entradas y hasta qué precio; avisa por Telegram en el segundo exacto; lleva la cuenta de límites,
        presupuesto y carritos. <b>Lo que no hace:</b> entrar en Ticketmaster, entradas.com o la web del Real Madrid, saltarse colas, resolver CAPTCHA ni pagar. Eso lo hace cada
        persona, como exigen las condiciones de esas webs.
      </Callout>

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="stack" style={{ gap: 10, minWidth: 0 }}>
          {STEPS.map((st) => (
            <Card key={st.n}>
              <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', gap: 14 }}>
                <div
                  aria-hidden
                  style={{
                    flex: '0 0 auto',
                    width: 38,
                    height: 38,
                    borderRadius: 19,
                    background: 'var(--ink)',
                    color: 'var(--surface)',
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 800,
                    fontSize: 17,
                  }}
                >
                  {st.n}
                </div>
                <div className="stack" style={{ gap: 6, minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <Pill tone={WHO_TONE[st.who]} icon={st.icon}>
                      {st.who}
                    </Pill>
                    <span className="small muted">{st.when}</span>
                  </div>
                  <b style={{ fontSize: 15 }}>{st.title}</b>
                  <span className="ink2">{st.text}</span>
                  {st.link ? (
                    <div>
                      <Link className="btn sm" to={st.link.to}>
                        {st.link.label} <Icon name="right" size={13} />
                      </Link>
                    </div>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>

        <div className="stack" style={{ gap: 16, minWidth: 0 }}>
          <Card title="Así se ve el plan en el plano">
            {art.data ? (
              <div className="stack" style={{ gap: 8 }}>
                <VenueMap artifact={art.data} targets={['Lateral Este · Primer anfiteatro', 'Fondo Sur · Segundo anfiteatro', 'Fondo Norte']} compact />
                <span className="small ink2">
                  Ejemplo en el Estadio Santiago Bernabéu: 1) Lateral Este · Primer anfiteatro; si no hay, 2) Fondo Sur · Segundo anfiteatro; si tampoco, 3) cualquier nivel del
                  Fondo Norte. Cada cuenta empieza por la 1 y, con «No pude», recibe al instante la siguiente.
                </span>
              </div>
            ) : (
              <span className="muted">El plano aparecerá cuando el vault tenga el Estadio Santiago Bernabéu.</span>
            )}
          </Card>
          <Card title="Telegram: el mando a distancia">
            <ul style={{ margin: 0, paddingLeft: 18 }} className="stack">
              <li>Plan antes de la venta, «¡Abre la venta!» en T0 y la tarea de cada persona con el botón a la web oficial.</li>
              <li>Respuestas de un toque: «Sesión lista», «2 en carrito», «No pude», minutos del carrito.</li>
              <li>Avisos de carrito a punto de caducar y «¡entradas aseguradas!».</li>
              <li>/estado, /tareas, /pausa y /parar_todo desde el chat principal.</li>
            </ul>
            <div style={{ marginTop: 10 }}>
              <Link className="btn sm" to="/ajustes">
                <Icon name="gear" size={13} /> Configurar Telegram
              </Link>
            </div>
          </Card>
          <Card title="Si algo va mal">
            <dl className="kv">
              <dt>No abre</dt>
              <dd>Vuelve a abrir INICIAR.bat (o «Sala de control» en el Escritorio).</dd>
              <dt>Sin Telegram</dt>
              <dd>Ajustes · Telegram → «Enviar mensaje de prueba».</dd>
              <dt>Se acabó el tiempo</dt>
              <dd>Carritos → «Ya lo he pagado» si llegaste a pagar; si no, «Liberar» y se reparten de nuevo.</dd>
              <dt>Pausar</dt>
              <dd>Botón Pausar en la operación o /pausa en Telegram.</dd>
              <dt>Parar todo</dt>
              <dd>Seguridad → kill switch global o /parar_todo.</dd>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
