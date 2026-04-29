import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/layout/auth-provider";
import LayoutShell from "@/components/layout/layout-shell";
import NextTopLoader from "nextjs-toploader";

// No web-font loader: the app uses the device's native system font via the
// stack defined in globals.css. macOS/iOS → SF Pro, Windows → Segoe UI,
// Android → Roboto, Linux → Noto Sans / Liberation Sans.

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
      <body className="font-sans antialiased min-h-screen" suppressHydrationWarning>
        <NextTopLoader color="#8b5cf6" height={3} showSpinner={false} />
        <AuthProvider>
          <LayoutShell>{children}</LayoutShell>
        </AuthProvider>
      </body>
    </html>
  );
}
