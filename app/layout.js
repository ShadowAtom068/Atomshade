import './globals.css';

export const metadata = {
  title: 'Atomshade',
  description: 'Fast, private chat for you and your people.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0a0a14',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before the page paints, so there is no flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var p=JSON.parse(localStorage.getItem('atomshade.prefs')||'{}');var t=p.theme==='light'?'light':p.theme==='system'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):'dark';var r=document.documentElement;r.dataset.theme=t;r.dataset.font=p.fontSize==='large'?'large':'normal';r.dataset.wallpaper=p.wallpaper||'default'}catch(e){}",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
