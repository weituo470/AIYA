import CreateStudioClient from './CreateStudioClient';

export const metadata = {
  title: 'AIYA Create | 一句话生成应用',
  description: '用一句话生成可运行的小应用或小游戏，并在浏览器沙盒中立即预览。',
};

export default function CreatePage() {
  return <CreateStudioClient />;
}
