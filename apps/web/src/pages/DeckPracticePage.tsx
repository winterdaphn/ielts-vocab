/**
 * Lightweight practice for chunks / frames (no LLM).
 * Modes: gloss quiz (chunk) or skeleton recall (frame).
 */
import { useMemo, useState } from 'react';
import { Button, Input, App } from 'antd';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useChunksStore, useChunksWithProgress } from '@/store/useChunks';
import { useFramesStore, useFramesWithProgress } from '@/store/useFrames';
import { applyReviewToProgress, isDue, isNew } from '@/utils/scheduler';
import { normalizePhraseKey } from '@/types/chunk';
import type { SrsProgress } from '@/types/srsProgress';

type Deck = 'chunk' | 'frame';
type Scope = 'review' | 'mixed' | 'new';

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function DeckPracticePage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const deck = (params.get('deck') === 'frame' ? 'frame' : 'chunk') as Deck;
  const scope = (params.get('scope') || 'mixed') as Scope;
  const focus = params.get('focus') || '';

  const chunks = useChunksWithProgress();
  const frames = useFramesWithProgress();
  const updateChunkProgress = useChunksStore((s) => s.updateProgress);
  const updateFrameProgress = useFramesStore((s) => s.updateProgress);

  const queue = useMemo(() => {
    if (deck === 'chunk') {
      let list = chunks.filter((c) => !c.progress.crossedOut);
      if (focus) list = list.filter((c) => c.id === focus);
      else if (scope === 'review') {
        list = list.filter((c) => !isNew(c.progress) && isDue(c.progress));
      } else if (scope === 'new') list = list.filter((c) => isNew(c.progress));
      else {
        const fresh = list.filter((c) => isNew(c.progress));
        const due = list.filter((c) => !isNew(c.progress) && isDue(c.progress));
        const rest = list.filter((c) => !isNew(c.progress) && !isDue(c.progress));
        list = [...fresh, ...due, ...shuffle(rest)].slice(0, 40);
      }
      return list.map((c) => ({
        id: c.id,
        prompt: c.gloss || '（无释义）',
        answer: c.phrase,
        hint: c.exampleEn || '',
        progress: c.progress,
      }));
    }
    let list = frames.filter((f) => !f.progress.crossedOut);
    if (focus) list = list.filter((f) => f.id === focus);
    else if (scope === 'review') {
      list = list.filter((f) => !isNew(f.progress) && isDue(f.progress));
    } else if (scope === 'new') list = list.filter((f) => isNew(f.progress));
    else {
      const fresh = list.filter((f) => isNew(f.progress));
      const due = list.filter((f) => !isNew(f.progress) && isDue(f.progress));
      list = [...fresh, ...due].slice(0, 40);
    }
    return list.map((f) => ({
      id: f.id,
      prompt: f.glossZh || f.title,
      answer: f.skeleton,
      hint: f.exampleFilled || '',
      progress: f.progress,
    }));
  }, [deck, scope, focus, chunks, frames]);

  const [idx, setIdx] = useState(0);
  const [input, setInput] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [stats, setStats] = useState({ correct: 0, total: 0 });

  const current = queue[idx];
  const done = queue.length === 0 || idx >= queue.length;

  async function grade(ok: boolean) {
    if (!current) return;
    const q = ok ? 5 : 1;
    const nextProg = applyReviewToProgress(
      { ...current.progress, updatedAt: Date.now() } as SrsProgress,
      q as 1 | 5
    );
    if (deck === 'chunk') await updateChunkProgress(nextProg);
    else await updateFrameProgress(nextProg);
    setStats((s) => ({
      correct: s.correct + (ok ? 1 : 0),
      total: s.total + 1,
    }));
    setRevealed(false);
    setInput('');
    setIdx((i) => i + 1);
  }

  function checkAnswer() {
    if (!current) return;
    const a = normalizePhraseKey(input);
    const b = normalizePhraseKey(current.answer);
    const ok = a === b || a.replace(/[\[\]]/g, '') === b.replace(/[\[\]]/g, '');
    if (ok) {
      message.success('正确');
      void grade(true);
    } else {
      setRevealed(true);
      message.error('再看看答案');
    }
  }

  if (queue.length === 0) {
    return (
      <div className="page-pad">
        <div className="app-card empty">
          <h3>没有可练的题目</h3>
          <p className="text-light">先在搭配本加入语块或模板</p>
          <Button type="primary" className="mt-3" onClick={() => navigate('/chunks')}>
            去搭配本
          </Button>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="page-pad">
        <div className="app-card empty">
          <h3>本轮完成</h3>
          <p>
            正确 {stats.correct} / {stats.total}
          </p>
          <Button type="primary" className="mt-3" onClick={() => navigate('/chunks')}>
            返回搭配
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-pad practice-mode">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <Button type="text" onClick={() => navigate('/chunks')}>
          退出
        </Button>
        <span className="text-light">
          {idx + 1} / {queue.length} · {deck === 'chunk' ? '语块' : '模板'}
        </span>
      </div>

      <div className="app-card">
        <p className="text-light" style={{ fontSize: 13, marginBottom: 8 }}>
          {deck === 'chunk' ? '根据释义写出搭配' : '根据说明写出句型骨架（可含 [slot]）'}
        </p>
        <p style={{ fontSize: 18, margin: '0 0 16px' }}>{current.prompt}</p>
        <Input.TextArea
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={deck === 'chunk' ? '输入英文搭配' : '输入 skeleton'}
          disabled={revealed}
        />
        {revealed ? (
          <div style={{ marginTop: 12 }}>
            <p>
              答案：<b>{current.answer}</b>
            </p>
            {current.hint ? (
              <p className="text-light" style={{ fontSize: 13 }}>
                {current.hint}
              </p>
            ) : null}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Button onClick={() => void grade(false)}>记错了</Button>
              <Button type="primary" onClick={() => void grade(true)}>
                其实会了
              </Button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <Button onClick={() => setRevealed(true)}>看答案</Button>
            <Button type="primary" onClick={checkAnswer}>
              提交
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
