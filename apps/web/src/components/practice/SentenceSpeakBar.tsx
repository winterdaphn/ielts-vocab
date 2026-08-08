import { useEffect, useState } from 'react';
import { Button } from 'antd';
import { SoundOutlined } from '@ant-design/icons';
import { speakEnglish, stopSpeaking } from '@/utils/speak';

/** 朗读整句（练习页音标行右侧） */
export default function SentenceSpeakButton({ text }: { text: string }) {
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    return () => {
      stopSpeaking();
      setSpeaking(false);
    };
  }, [text]);

  if (!text.trim()) return null;

  return (
    <Button
      size="small"
      icon={<SoundOutlined />}
      loading={speaking}
      className="sentence-speak-btn"
      onClick={() =>
        speakEnglish(text, {
          onStart: () => setSpeaking(true),
          onEnd: () => setSpeaking(false),
        })
      }
    >
      朗读整句
    </Button>
  );
}
