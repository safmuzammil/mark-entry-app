import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: 'School Mark Portal',
  description: 'Teacher and Admin Management Portal',
  manifest: '/manifest.json?v=4', // Bumped version to force devices to fetch the new logo
  icons: {
    icon: 'https://ik.imagekit.io/syustaging/SYU_PREPROD/LOGO_XGQrxvsxO.webp?tr=w-3840',
    apple: 'https://ik.imagekit.io/syustaging/SYU_PREPROD/LOGO_XGQrxvsxO.webp?tr=w-3840',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'MarkPortal',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta name="theme-color" content="#2563eb" />
        {/* Register the Service Worker to unlock Android Installation */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js').then(function(registration) {
                    console.log('ServiceWorker registration successful');
                  }, function(err) {
                    console.log('ServiceWorker registration failed: ', err);
                  });
                });
              }
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}