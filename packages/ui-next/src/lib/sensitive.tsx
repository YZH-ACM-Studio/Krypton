import { createContext, useContext, useState, type PropsWithChildren } from 'react';

const STORAGE_KEY = 'krypton:sensitive-visible';

interface SensitiveContextValue {
  visible: boolean;
  toggle: () => void;
}

const SensitiveContext = createContext<SensitiveContextValue>({
  visible: false,
  toggle: () => {},
});

export function SensitiveProvider({ children }: PropsWithChildren) {
  const [visible, setVisible] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
  });

  const toggle = () => {
    setVisible((prev) => {
      const next = !prev;
      try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0'); } catch {}
      return next;
    });
  };

  return (
    <SensitiveContext.Provider value={{ visible, toggle }}>
      {children}
    </SensitiveContext.Provider>
  );
}

export function useSensitive() {
  return useContext(SensitiveContext);
}

/** Wrapper that blurs/masks content when sensitive mode is off */
export function Sensitive({ children, placeholder = '••••••' }: PropsWithChildren<{ placeholder?: string }>) {
  const { visible } = useSensitive();
  if (visible) return <>{children}</>;
  return <span className="select-none text-muted-foreground/60">{placeholder}</span>;
}
