import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Puente — Trade Finance on Base',
  description: 'Non-custodial trade finance for the Mexico–Singapore corridor',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  );
}
