import { useCallback, useRef, useState } from 'react';

type Props = {
  letters: string[];
  activeLetter?: string;
  onSelect: (letter: string) => void;
};

function letterFromPoint(
  root: HTMLElement,
  clientY: number,
  letters: string[]
): string | null {
  const rect = root.getBoundingClientRect();
  if (letters.length === 0) return null;
  const y = Math.min(Math.max(clientY - rect.top, 0), rect.height - 1);
  const idx = Math.min(
    letters.length - 1,
    Math.floor((y / rect.height) * letters.length)
  );
  return letters[idx] ?? null;
}

/** Mobile-style A–Z side index; works with virtual list via onSelect. */
export default function LetterIndexBar({ letters, activeLetter, onSelect }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const pick = useCallback(
    (clientY: number) => {
      const root = rootRef.current;
      if (!root) return;
      const letter = letterFromPoint(root, clientY, letters);
      if (!letter) return;
      setHint(letter);
      onSelect(letter);
    },
    [letters, onSelect]
  );

  const endDrag = useCallback(() => {
    draggingRef.current = false;
    setDragging(false);
    setHint(null);
  }, []);

  if (letters.length === 0) return null;

  return (
    <div
      ref={rootRef}
      className={`letter-index-bar${dragging ? ' is-dragging' : ''}`}
      role="navigation"
      aria-label="字母索引"
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        draggingRef.current = true;
        setDragging(true);
        pick(e.clientY);
      }}
      onPointerMove={(e) => {
        if (!draggingRef.current) return;
        pick(e.clientY);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {hint && <div className="letter-index-hint">{hint}</div>}
      {letters.map((letter) => (
        <span
          key={letter}
          className={`letter-index-item${activeLetter === letter ? ' active' : ''}`}
        >
          {letter}
        </span>
      ))}
    </div>
  );
}
