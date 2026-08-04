import { Button, Space } from 'antd';
import type { Mode } from '@/utils/practiceSelect';

interface Props {
  onStart: (mode: Mode) => void;
  onBack: () => void;
}

export default function PracticeModeSelect({ onStart, onBack }: Props) {
  return (
    <div>
      <div className="app-header">
        <h1>选择练习模式</h1>
        <p>挑一种方式开始今日训练</p>
      </div>
      <div className="app-card">
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Button type="primary" size="large" block onClick={() => onStart('cloze')}>
            输入填空
          </Button>
          <Button size="large" block onClick={() => onStart('choice')}>
            选词填空
          </Button>
          <Button size="large" block onClick={() => onStart('translate')}>
            句子翻译
          </Button>
          <Button type="text" block onClick={onBack}>
            返回
          </Button>
        </Space>
      </div>
    </div>
  );
}
