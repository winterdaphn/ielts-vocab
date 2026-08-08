import { useEffect, useState } from 'react';
import { Button } from 'antd';
import { SoundOutlined } from '@ant-design/icons';
import { speakEnglish, stopSpeaking } from '@/utils/speak';

/** 练习揭晓后朗读整句（移动端比句旁小图标更易点） */
export default function SentenceSpeakBar({ text }: { text: string }) {
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    return () => {
      stopSpeaking();
      setSpeaking(false);
    };
  }, [text]);

  if (!text.trim()) return null;

  return (
    <div className="sentence-speak-bar">
      <span className="text-light" style={{ fontSize: 12 }}>
        例句
      </span>
      <Button
        size="small"
        icon={<SoundOutlined />}
        loading={speaking}
        onClick={() =>
          speakEnglish(text, {
            onStart: () => setSpeaking(true),
            onEnd: () => setSpeaking(false),
          })
        }
      >
        朗读整句
      </Button>
    </div>
  );
}
