import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { ToastProvider } from '@/components/ui/Toast';
import { I18nProvider } from '@/src/i18n/client';
import { getLocale } from '@/src/i18n/server';

const appFont = localFont({
  src: '../node_modules/next/dist/next-devtools/server/font/geist-latin.woff2',
  variable: '--font-app',
  display: 'swap',
  weight: '100 900',
});

export const metadata: Metadata = {
  title: 'Lumbung — coordination layer for Indonesian food redistribution',
  description:
    'Routes, plans and proves every surplus food donation — fairness-aware, spoilage-aware, with a human approving every allocation.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#000000',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`h-full ${appFont.variable}`}>
      <body className="min-h-full">
        <I18nProvider locale={locale}>
          <ToastProvider>{children}</ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
