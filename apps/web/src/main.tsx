import { RealtimeClient } from '@inventur/shared';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App.tsx';
import './styles.css';
import { RealtimeProvider, realtimeUrl } from './realtime/RealtimeProvider.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('Element #root is missing');

const realtime = new RealtimeClient({ url: realtimeUrl(window.location) });

createRoot(root).render(
  <StrictMode>
    <RealtimeProvider client={realtime}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </RealtimeProvider>
  </StrictMode>,
);
