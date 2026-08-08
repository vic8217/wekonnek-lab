import type { Metadata, Viewport } from "next";
import "./globals.css";
import 'leaflet/dist/leaflet.css';
import RegisterSW from './register-sw';
import OfflineIndicator from '@/components/OfflineIndicator';
import PWAInstallPrompt from '@/components/PWAInstallPrompt';
import ConditionalFooter from '@/components/ConditionalFooter';
import { Providers } from './providers';
import { Toaster } from 'react-hot-toast';

export const metadata: Metadata = {
  title: "WeKonnek - Local Discovery App",
  description: "Your trusted community trading system connecting local services and products",
  manifest: "/manifest.json",
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "WeKonnek",
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: "website",
    siteName: "WeKonnek",
    title: "WeKonnek - Local Discovery App",
    description: "Your trusted community trading system connecting local services and products",
  },
  twitter: {
    card: "summary",
    title: "WeKonnek - Local Discovery App",
    description: "Your trusted community trading system connecting local services and products",
  },
};

export const viewport: Viewport = {
  themeColor: "#DB0002",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
              function isInjectedWalletError(value) {
                var message = String((value && value.message) || value || '');
                var stack = String((value && value.stack) || '');
                return /Failed to connect to MetaMask/i.test(message) ||
                  (/chrome-extension:\/\//i.test(stack) && /MetaMask|Object\.connect|inpage\.js/i.test(message + stack));
              }
              window.addEventListener('unhandledrejection', function(event) {
                if (isInjectedWalletError(event.reason)) {
                  event.preventDefault();
                  event.stopImmediatePropagation();
                }
              }, true);
              window.addEventListener('error', function(event) {
                if (isInjectedWalletError(event.error || event.message)) {
                  event.preventDefault();
                  event.stopImmediatePropagation();
                }
              }, true);
            })();`,
          }}
        />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="WeKonnek" />
      </head>
      <body className="antialiased">
        <Providers>
          <Toaster
            position="top-center"
            toastOptions={{
              duration: 3000,
              style: { borderRadius: '12px', padding: '12px 16px', fontSize: '14px' },
              success: { iconTheme: { primary: '#16a34a', secondary: '#fff' } },
              error: { iconTheme: { primary: '#DB0002', secondary: '#fff' } },
            }}
          />
          <RegisterSW />
          <OfflineIndicator />
          <PWAInstallPrompt />
          {children}
          <ConditionalFooter />
        </Providers>
      </body>
    </html>
  );
}
