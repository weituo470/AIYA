'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useState } from 'react';

const QueryClientContext = createContext<QueryClient | null>(null);

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientContext.Provider value={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </QueryClientContext.Provider>
  );
}

export function useAppQueryClient() {
  const queryClient = useContext(QueryClientContext);
  if (!queryClient) {
    throw new Error('useAppQueryClient must be used within Providers');
  }
  return queryClient;
}
