import SpeakButton from '@/components/SpeakButton';
import { resolvePhonetics, type PhoneticFields } from '@/utils/phonetic';

interface Props {
  word: PhoneticFields & { word?: string };
  /** Show speak buttons next to each accent. */
  withSpeak?: boolean;
  className?: string;
}

/** Dual phonetic display: 美 /…/ · 英 /…/ (one line when identical). */
export default function PhoneticDisplay({ word, withSpeak = false, className = '' }: Props) {
  const text = word.word || '';
  const { us, uk } = resolvePhonetics(word);
  if (!us && !uk) return null;

  if (us && uk && us === uk) {
    return (
      <span className={`phonetic-pair ${className}`.trim()}>
        <span className="phonetic-item">
          <span className="phonetic">{us}</span>
          {withSpeak && text ? <SpeakButton text={text} accent="us" title="发音" /> : null}
        </span>
      </span>
    );
  }

  return (
    <span className={`phonetic-pair ${className}`.trim()}>
      {us ? (
        <span className="phonetic-item">
          <span className="accent-tag">美</span>
          <span className="phonetic">{us}</span>
          {withSpeak && text ? <SpeakButton text={text} accent="us" title="美音" /> : null}
        </span>
      ) : null}
      {uk ? (
        <span className="phonetic-item">
          <span className="accent-tag">英</span>
          <span className="phonetic">{uk}</span>
          {withSpeak && text ? <SpeakButton text={text} accent="uk" title="英音" /> : null}
        </span>
      ) : null}
    </span>
  );
}
