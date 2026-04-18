import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { BootstrapProvider, getBootstrapFromWindow } from '@/lib/bootstrap';
import { router } from '@/router';
import './styles.css';

const bootstrap = getBootstrapFromWindow();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BootstrapProvider bootstrap={bootstrap}>
      <RouterProvider router={router} />
    </BootstrapProvider>
  </StrictMode>,
);
