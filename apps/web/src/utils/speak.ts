/**
 * TTS helper — prefer Youdao dictvoice (UK/US), fall back to speechSynthesis.
 * Mirrors example.html speakWord / ttsUrlsFor.
 */

export type SpeakAccent = 'us' | 'uk';

let currentAudio: HTMLAudioElement | null = null;

export function stopSpeaking(): void {
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.src = '';
    } catch {
      /* ignore */
    }
    currentAudio = null;
  }
  if (window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
  }
}

function youdaoUrl(word: string, accent: SpeakAccent): string {
  const type = accent === 'uk' ? 1 : 2;
  return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=${type}`;
}

function playAudioUrl(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    stopSpeaking();
    const audio = new Audio(url);
    currentAudio = audio;
    audio.onended = () => {
      if (currentAudio === audio) currentAudio = null;
      resolve();
    };
    audio.onerror = () => {
      if (currentAudio === audio) currentAudio = null;
      reject(new Error('audio failed'));
    };
    audio.play().catch(reject);
  });
}

function speakSynthesis(
  text: string,
  accent: SpeakAccent,
  opts?: { onStart?: () => void; onEnd?: () => void }
): void {
  if (!window.speechSynthesis) {
    opts?.onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = accent === 'uk' ? 'en-GB' : 'en-US';
  u.rate = 0.9;
  opts?.onStart?.();
  u.onend = () => opts?.onEnd?.();
  u.onerror = () => opts?.onEnd?.();
  window.speechSynthesis.speak(u);
}

/** Speak a word; accent selects Youdao type / TTS locale. */
export function speakEnglish(
  text: string,
  opts?: {
    accent?: SpeakAccent;
    onStart?: () => void;
    onEnd?: () => void;
  }
): void {
  const trimmed = String(text || '').trim();
  if (!trimmed) return;

  const accent: SpeakAccent = opts?.accent === 'uk' ? 'uk' : 'us';
  stopSpeaking();

  // Single-token words: try Youdao first
  if (!/\s/.test(trimmed)) {
    opts?.onStart?.();
    playAudioUrl(youdaoUrl(trimmed, accent))
      .then(() => opts?.onEnd?.())
      .catch(() => {
        speakSynthesis(trimmed, accent, opts);
      });
    return;
  }

  speakSynthesis(trimmed, accent, opts);
}
