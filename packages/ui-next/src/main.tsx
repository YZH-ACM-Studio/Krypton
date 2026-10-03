// Side-effect: register built-in admin nav sections.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { MotionConfig } from 'motion/react';
import { BootstrapProvider, getBootstrapFromWindow } from '@/lib/bootstrap';
import { router } from '@/router';
// Side-effect: register built-in admin nav sections.
import '@/lib/admin-nav-builtins';
import './styles.css';

const bootstrap = getBootstrapFromWindow();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <BootstrapProvider bootstrap={bootstrap}>
        <RouterProvider router={router} />
      </BootstrapProvider>
    </MotionConfig>
  </StrictMode>,
);
