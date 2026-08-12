/** 渲染搭配本 Markdown 风格解释（段落 + 加粗标签列表） */
import type { ReactNode } from 'react';

function renderInline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

export default function ChunkExplanationView({ text }: { text: string }) {
  if (!text.trim()) return null;

  const blocks = text.trim().split(/\n\n+/);

  return (
    <div className="chunk-explanation" style={{ fontSize: 14, lineHeight: 1.65 }}>
      {blocks.map((block, bi) => {
        const lines = block.split('\n').filter((l) => l.trim());
        const allBullets = lines.every((l) => /^-\s/.test(l.trim()));
        if (allBullets) {
          return (
            <ul
              key={bi}
              style={{ margin: bi ? '12px 0 0' : 0, paddingLeft: 20 }}
            >
              {lines.map((line, li) => (
                <li key={li} style={{ marginBottom: 6 }}>
                  {renderInline(line.replace(/^-\s*/, ''))}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={bi} style={{ margin: bi ? '12px 0 0' : 0 }}>
            {renderInline(block.replace(/\n/g, ' '))}
          </p>
        );
      })}
    </div>
  );
}
