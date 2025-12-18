import type { Metadata } from "next";
import "./globals.css";
import { ReactNode } from "react";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "O.R.I.O.N — Painel Stark",
  description: "Dashboard premium do O.R.I.O.N",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
