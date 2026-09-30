import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

interface AskOptions {
  title: string;
  body?: ReactNode;
  confirmText?: string;
  danger?: boolean;
  /** Con `options` es un desplegable (solo se puede elegir uno de ellos; su `hint` sale debajo). */
  input?: { label: string; type?: 'text' | 'number'; defaultValue?: string; placeholder?: string; hint?: string; options?: Array<{ value: string; label: string; hint?: string }> };
}

type Resolver = (value: string | boolean | null) => void;

const DialogCtx = createContext<(opts: AskOptions) => Promise<string | boolean | null>>(async () => null);

/** Diálogo de confirmación o de pedir un valor, con <dialog> nativo (accesible por teclado). */
export function DialogProvider({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [opts, setOpts] = useState<AskOptions | null>(null);
  const [value, setValue] = useState('');
  const resolver = useRef<Resolver | null>(null);

  const ask = useCallback((o: AskOptions) => {
    setOpts(o);
    setValue(o.input?.defaultValue ?? '');
    return new Promise<string | boolean | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  useEffect(() => {
    if (opts && ref.current && !ref.current.open) ref.current.showModal();
  }, [opts]);

  const close = (result: string | boolean | null) => {
    ref.current?.close();
    resolver.current?.(result);
    resolver.current = null;
    setOpts(null);
  };

  return (
    <DialogCtx.Provider value={ask}>
      {children}
      <dialog ref={ref} className="modal" onCancel={(e) => { e.preventDefault(); close(null); }}>
        {opts ? (
          <form
            method="dialog"
            onSubmit={(e) => {
              e.preventDefault();
              close(opts.input ? value : true);
            }}
          >
            <div className="modal-head">
              <h2 className="display" style={{ fontSize: 22 }}>
                {opts.title}
              </h2>
            </div>
            <div className="modal-body stack">
              {opts.body ? <div className="ink2">{opts.body}</div> : null}
              {opts.input ? (
                <div className="field">
                  <label htmlFor="dlg-input">{opts.input.label}</label>
                  {opts.input.options ? (
                    <select id="dlg-input" className="input" autoFocus value={value} onChange={(e) => setValue(e.target.value)}>
                      {opts.input.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="dlg-input"
                      className="input"
                      autoFocus
                      type={opts.input.type ?? 'text'}
                      value={value}
                      placeholder={opts.input.placeholder}
                      onChange={(e) => setValue(e.target.value)}
                      step="any"
                    />
                  )}
                  {(opts.input.options?.find((o) => o.value === value)?.hint ?? opts.input.hint) ? (
                    <span className="hint">{opts.input.options?.find((o) => o.value === value)?.hint ?? opts.input.hint}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn" onClick={() => close(null)}>
                Cancelar
              </button>
              <button type="submit" className={`btn ${opts.danger ? 'danger solid' : 'primary'}`} autoFocus={!opts.input}>
                {opts.confirmText ?? 'Confirmar'}
              </button>
            </div>
          </form>
        ) : null}
      </dialog>
    </DialogCtx.Provider>
  );
}

export function useDialog() {
  return useContext(DialogCtx);
}
