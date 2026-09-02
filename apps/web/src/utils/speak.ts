/**
 * TTS helper — prefer Youdao dictvoice (UK/US) for single words, fall back to speechSynthesis.
 *
 * Long sentences: browser speechSynthesis only (Youdao dictvoice is word-sized).
 * On iPhone/iPad, Chrome uses the same WebKit TTS as Safari — not Google cloud voices.
 */

export type SpeakAccent = 'us' | 'uk';

let currentAudio: HTMLAudioElement | null = null;
let cachedVoices: SpeechSynthesisVoice[] = [];

function refreshVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !window.speechSynthesis) return [];
  cachedVoices = window.speechSynthesis.getVoices() || [];
  return cachedVoices;
}

if (typeof window !== 'undefined' && window.speechSynthesis) {
  refreshVoices();
  window.speechSynthesis.addEventListener('voiceschanged', refreshVoices);
}

function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod|Macintosh|Mac OS X/i.test(navigator.userAgent);
}

/** Prefer natural / enhanced English voices (iOS Samantha, macOS Daniel, etc.). */
function pickEnglishVoice(
  voices: SpeechSynthesisVoice[],
  accent: SpeakAccent
): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const langPrimary = accent === 'uk' ? 'en-gb' : 'en-us';
  const quality =
    /enhanced|premium|natural|neural|samantha|aaron|nicky|daniel|karen|moira|alex|ava|siri|google.*english/i;

  const byLang = (prefix: string) =>
    voices.find((v) => v.lang.toLowerCase().startsWith(prefix) && quality.test(v.name)) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(prefix));

  return (
    byLang(langPrimary) ||
    voices.find((v) => v.lang.toLowerCase().startsWith('en') && quality.test(v.name)) ||
    voices.find((v) => v.lang.toLowerCase().startsWith('en')) ||
    null
  );
}

function scheduleSynthesisEndGuards(
  synth: SpeechSynthesis,
  text: string,
  end: () => void
): void {
  // Chromium/Windows only: queue can stay pending forever — clear loading if speech never starts.
  // Do NOT run on macOS/iOS: enhanced voices may take >600ms to start and synth.speaking stays
  // false while pending, which caused sentence TTS to be cancelled before any audio played.
  if (!isApplePlatform()) {
    setTimeout(() => {
      if (!synth.speaking && !synth.pending) {
        try {
          synth.cancel();
        } catch {
          /* ignore */
        }
        end();
      }
    }, 800);
  }

  // Some builds never fire onend even while audio plays.
  setTimeout(end, Math.min(120_000, Math.max(4_000, text.length * 90)));
}

/** Windows-safe path — matches pre-enhancement behavior (lang only, no voice object). */
function speakSynthesisSimple(
  text: string,
  accent: SpeakAccent,
  opts?: { onStart?: () => void; onEnd?: () => void }
): void {
  const synth = window.speechSynthesis;
  if (!synth) {
    opts?.onEnd?.();
    return;
  }

  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = accent === 'uk' ? 'en-GB' : 'en-US';
  u.rate = 0.9;

  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    opts?.onEnd?.();
  };

  u.onend = end;
  u.onerror = () => end();

  opts?.onStart?.();
  synth.speak(u);
  scheduleSynthesisEndGuards(synth, text, end);
}

/** macOS/iOS — pick enhanced voice when available; fall back to lang-only on error. */
function speakSynthesisEnhanced(
  text: string,
  accent: SpeakAccent,
  voices: SpeechSynthesisVoice[],
  opts?: { onStart?: () => void; onEnd?: () => void },
  allowSimpleFallback = true
): void {
  const synth = window.speechSynthesis;
  if (!synth) {
    opts?.onEnd?.();
    return;
  }

  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = accent === 'uk' ? 'en-GB' : 'en-US';
  u.rate = 0.88;
  u.pitch = 1;
  const voice = pickEnglishVoice(voices, accent);
  if (voice) u.voice = voice;

  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    opts?.onEnd?.();
  };

  u.onend = end;
  u.onerror = () => {
    if (allowSimpleFallback && voice) {
      speakSynthesisSimple(text, accent, opts);
      return;
    }
    end();
  };

  opts?.onStart?.();
  synth.speak(u);
  if (synth.paused) {
    try {
      synth.resume();
    } catch {
      /* ignore */
    }
  }
  scheduleSynthesisEndGuards(synth, text, end);
}

function speakSynthesis(
  text: string,
  accent: SpeakAccent,
  opts?: { onStart?: () => void; onEnd?: () => void }
): void {
  if (!isApplePlatform()) {
    speakSynthesisSimple(text, accent, opts);
    return;
  }

  const voices = refreshVoices();
  if (voices.length) {
    speakSynthesisEnhanced(text, accent, voices, opts);
    return;
  }

  // Sync lang-only path preserves user-gesture activation; async wait broke TTS on some builds.
  speakSynthesisSimple(text, accent, opts);
}

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

/** Speak text; single words try Youdao MP3 first. Sentences use system speechSynthesis. */
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
