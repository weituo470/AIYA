import './globals.css';
import '@xterm/xterm/css/xterm.css';
import { Providers } from './providers';

export const metadata = {
  title: 'Aiya 中文工作台',
  description: '面向中文场景的人机协同与智能体消息平台。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
