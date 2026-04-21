import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/layout/auth-provider";
import LayoutShell from "@/components/layout/layout-shell";
import NextTopLoader from "nextjs-toploader";

// Inter — the typeface Keka uses. Loaded globally, exposed as --font-mulish
// so every existing `font-[--font-mulish]` reference continues to work.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-mulish",
  display: "swap",
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
    <html lang="en" style={{ colorScheme: "light" }}>
      <head>
        {/* Force light mode — strip any legacy `dark` class before the app hydrates. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{document.documentElement.classList.remove('dark');localStorage.removeItem('theme');}catch(e){}`,
          }}
        />
      </head>
      <body className={`${inter.variable} font-sans antialiased min-h-screen`}>
        <NextTopLoader color="#8b5cf6" height={3} showSpinner={false} />
        <AuthProvider>
          <LayoutShell>{children}</LayoutShell>
        </AuthProvider>
      </body>
    </html>
  );
}
