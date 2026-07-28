import { useEffect, useState } from 'react';
import { SoundOutlined } from '@ant-design/icons';
import { speakEnglish, stopSpeaking, type SpeakAccent } from '@/utils/speak';

interface Props {
  text: string;
  title?: string;
  className?: string;
  accent?: SpeakAccent;
}

/** Icon speak button — used next to answer words / word list. */
export default function SpeakButton({
  text,
  title = '发音',
  className = 'speak-btn',
  accent = 'us',
}: Props) {
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    return () => {
      stopSpeaking();
    };
  }, [text, accent]);

  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    if (!text.trim()) return;
    speakEnglish(text, {
      accent,
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
