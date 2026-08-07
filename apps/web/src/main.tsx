import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App';
import { applyDocumentLocale, normalizeLocale } from './i18n/document-locale';
import './styles/index.css';
import { synchronizeTheme } from './theme/theme';

applyDocumentLocale(document, normalizeLocale(document.documentElement.lang));
synchronizeTheme({
  root: document.documentElement,
  storage: window.localStorage,
  matchMedia: window.matchMedia.bind(window),
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
