import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/inter';
import '@fontsource-variable/manrope';
import './globals.css';

export const metadata: Metadata = {
  title: 'DataEngine Studio — Good data starts here',
  description: 'A private, end-to-end data workspace. Import, clean, transform, validate, visualize, and export your data — right in your browser.',
  applicationName: 'DataEngine Studio',
  robots: { index: true, follow: true },
  icons: { icon: '/icon.svg' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0c8968' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
