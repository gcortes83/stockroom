import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { Toaster } from 'sonner';
import { ProblemError } from '@/shared/api/http';
import { initTheme, useTheme } from '@/shared/lib/theme';
import { router } from './app/router';

initTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) =>
        failureCount < 1 && !(error instanceof ProblemError && error.status >= 400 && error.status < 500),
    },
    mutations: { retry: 0 },
  },
});

function App() {
  const theme = useTheme();
  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <RouterProvider router={router} />
      </MotionConfig>
      <Toaster theme={theme} position="bottom-right" richColors closeButton toastOptions={{ className: 'glass-strong' }} />
    </QueryClientProvider>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
