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
      onClick={() => {
        const sentence = text.trim();
        if (!sentence) return;
        setSpeaking(true);
        speakEnglish(sentence, {
          onEnd: () => setSpeaking(false),
        });
        // 兜底：避免 onEnd 未触发时按钮一直 loading
        window.setTimeout(
          () => setSpeaking(false),
          Math.min(120_000, Math.max(4_000, sentence.length * 90))
        );
      }}
    >
      朗读整句
    </Button>
  );
}
