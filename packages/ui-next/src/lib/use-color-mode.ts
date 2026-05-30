/**
 * `useColorMode()` — observe whether the document is in dark mode.
 *
 * The Krypton app toggles dark mode by adding/removing the `.dark` class on
 * `<html>` (see router.tsx + layout/exam-shell.tsx). xyflow v12's `colorMode`
 * prop wants `'light'` | `'dark'` | `'system'`, so we map our class-based
 * theme into that vocabulary and re-render the canvas whenever the user
 * flips the theme switch.
 *
 * Uses a MutationObserver on the documentElement classList so we don't have
 * to wire up event listeners on every toggle source.
 */
import { useEffect, useState } from 'react';

export type ColorMode = 'light' | 'dark';

function readMode(): ColorMode {
    if (typeof document === 'undefined') return 'light';
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function useColorMode(): ColorMode {
    const [mode, setMode] = useState<ColorMode>(() => readMode());

    useEffect(() => {
        if (typeof document === 'undefined') return;
        const html = document.documentElement;
        const update = () => setMode(readMode());
        const observer = new MutationObserver((records) => {
            for (const r of records) {
                if (r.type === 'attributes' && r.attributeName === 'class') {
                    update();
                    return;
                }
            }
        });
        observer.observe(html, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);

    return mode;
}
