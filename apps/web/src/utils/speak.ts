/**
 * TTS helper — prefer Youdao dictvoice (UK/US), fall back to speechSynthesis.
 *
 * Sentences: try Youdao first (short phrases), then browser speechSynthesis.
 * Do not assign speechSynthesis.voice on Chrome/macOS — causes silent failures.
 */

export type SpeakAccent = 'us' | 'uk';

let currentAudio: HTMLAudioElement | null = null;

function resumeSynth(synth: SpeechSynthesis): void {
  try {
    if (synth.paused) synth.resume();
  } catch {
    /* ignore */
  }
}

function speakSynthesis(
  text: string,
  accent: SpeakAccent,
  opts?: { onStart?: () => void; onEnd?: () => void }
): void {
  const synth = window.speechSynthesis;
  if (!synth) {
    opts?.onEnd?.();
    return;
  }

  resumeSynth(synth);
  synth.cancel();
  resumeSynth(synth);

  const u = new SpeechSynthesisUtterance(text);
  u.lang = accent === 'uk' ? 'en-GB' : 'en-US';
  u.rate = 0.9;
  u.volume = 1;

  let ended = false;
  let started = false;
  const end = () => {
    if (ended) return;
    ended = true;
    opts?.onEnd?.();
  };

  u.onstart = () => {
    started = true;
  };
  u.onend = end;
  u.onerror = (e) => {
    if (e.error === 'interrupted' || e.error === 'canceled') {
      end();
      return;
    }
    end();
  };

  opts?.onStart?.();
  synth.speak(u);
  resumeSynth(synth);

  // Nothing entered the queue (Chrome/macOS silent fail).
  setTimeout(() => {
    if (!ended && !started && !synth.speaking && !synth.pending) end();
  }, 500);

  // onend sometimes never fires after successful playback.
  setTimeout(() => {
    if (!ended && started) end();
  }, Math.min(120_000, Math.max(4_000, text.length * 90)));
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

function youdaoUrl(text: string, accent: SpeakAccent): string {
  const type = accent === 'uk' ? 1 : 2;
  return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&type=${type}`;
}

function playAudioUrl(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    stopSpeaking();
    const audio = new Audio(url);
    currentAudio = audio;
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (currentAudio === audio) currentAudio = null;
      ok ? resolve() : reject(new Error('audio failed'));
    };
    const timer = setTimeout(() => done(false), 5_000);
    audio.onended = () => done(true);
    audio.onerror = () => done(false);
    audio.play().catch(() => done(false));
  });
}

/** Speak text; tries Youdao MP3 first, then system speechSynthesis. */
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

  opts?.onStart?.();
  playAudioUrl(youdaoUrl(trimmed, accent))
    .then(() => opts?.onEnd?.())
    .catch(() => {
      speakSynthesis(trimmed, accent, opts);
    });
}
