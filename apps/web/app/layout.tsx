import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Puente",
  description: "Non-custodial trade finance on Base",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
