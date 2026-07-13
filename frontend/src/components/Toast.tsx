import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import css from "./ui.module.css";

type ToastKind = "ok" | "err" | "info";
interface ToastItem {
  id: number;
  kind: ToastKind;
  msg: ReactNode;
}

const ToastCtx = createContext<(kind: ToastKind, msg: ReactNode) => void>(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((kind: ToastKind, msg: ReactNode) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, kind, msg }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 6000);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className={css.toastWrap} aria-live="polite" aria-atomic="false">
        {items.map((t) => (
          <div key={t.id} className={`${css.toast} ${css[t.kind]}`} role="status">
            <span className={css.bar} aria-hidden="true" />
            <span className={css.toastMsg}>{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
