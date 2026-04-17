import type { Metadata } from "next";
import { Mulish } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/layout/auth-provider";
import LayoutShell from "@/components/layout/layout-shell";
import NextTopLoader from "nextjs-toploader";

const mulish = Mulish({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-mulish",
});

export const metadata: Metadata = {
  title: "NB Media Productions — Dashboard",
  description: "Production Management Dashboard for NB Media Productions",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${mulish.variable} font-sans antialiased min-h-screen`}>
        <NextTopLoader color="#8b5cf6" height={3} showSpinner={false} />
        <AuthProvider>
          <LayoutShell>{children}</LayoutShell>
        </AuthProvider>
      </body>
    </html>
  );
}
