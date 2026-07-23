import { useEffect, useState } from 'react';
import { SoundOutlined } from '@ant-design/icons';
import { speakEnglish, stopSpeaking } from '@/utils/speak';

interface Props {
  text: string;
  title?: string;
  className?: string;
}

/** Icon speak button — used next to answer words / word list. */
export default function SpeakButton({ text, title = '发音', className = 'speak-btn' }: Props) {
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    return () => {
      stopSpeaking();
    };
  }, [text]);

  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    if (!text.trim()) return;
    speakEnglish(text, {
      onStart: () => setSpeaking(true),
      onEnd: () => setSpeaking(false),
    });
  }

  return (
    <button
      type="button"
      className={`${className}${speaking ? ' speaking' : ''}`}
      title={title}
      aria-label={title}
      onClick={handleClick}
    >
      <SoundOutlined />
    </button>
  );
}
