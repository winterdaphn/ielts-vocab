import CollapsibleTip from '@/components/practice/CollapsibleTip';
import RelatedWordsList from '@/components/RelatedWordsList';
import { useSynonymDiffAssist } from '@/components/SynonymDiffAssist';
import { useWordsStore, useUserWords } from '@/store/useWords';
import type { RelatedWord } from '@/types/word';

interface Props {
  /** Persist synonymDiff onto this local word id */
  wordId: string;
  headword: string;
  translation?: string;
  synonyms: RelatedWord[];
  /** Current practice sentence — for「本句能否替换」 */
  sentence?: string;
  sectionKey: string;
  loading?: boolean;
  defaultOpen?: boolean;
}

/** Practice tip: 近义词 list + AI 辨析 on the title row */
export default function SynonymTipBlock({
  wordId,
  headword,
  translation,
  synonyms,
  sentence,
  sectionKey,
  loading = false,
  defaultOpen = false,
}: Props) {
  const words = useUserWords();
  const updateWord = useWordsStore((s) => s.updateWord);
  const local = words.find((w) => w.id === wordId);

  const { trigger, panel } = useSynonymDiffAssist({
    headword,
    translation,
    synonyms,
    sentence,
    compact: true,
    stored: local?.synonymDiff,
    onSave: async (diff) => {
      const latest = words.find((w) => w.id === wordId);
      if (!latest) return;
      await updateWord({ ...latest, synonymDiff: diff });
    },
  });
  const showingDiff = !!panel;

  return (
    <CollapsibleTip
      title="近义词"
      sectionKey={sectionKey}
      defaultOpen={defaultOpen}
      forceOpen={showingDiff}
      actions={synonyms.length > 0 ? trigger : undefined}
    >
      {loading && !synonyms.length ? (
        <span className="text-light" style={{ fontSize: 12 }}>
          加载中…
        </span>
      ) : (
        <RelatedWordsList items={synonyms} emptyText="暂无近义词" />
      )}
      {panel}
    </CollapsibleTip>
  );
}
