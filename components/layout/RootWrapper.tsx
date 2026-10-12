'use client';

import { Sidebar } from './Sidebar';

export function RootWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-4 pt-16 md:p-6 md:pt-6">
        {children}
      </main>
    </div>
  );
}
