/**
 * Prefab IELTS writing/speaking frame pack (Phase 2).
 * User adds items into personal frames deck; not auto-SRS until added.
 */
import type { Frame } from '@/types/frame';
import { normalizeFrameKey } from '@/types/frame';

export interface FramePackItem {
  packId: string;
  title: string;
  skeleton: string;
  slots: Frame['slots'];
  glossZh: string;
  exampleFilled: string;
}

export const FRAME_PACK_ID = 'ielts-writing-core';

export const FRAME_PACK: FramePackItem[] = [
  {
    packId: FRAME_PACK_ID,
    title: 'Growing concern that…',
    skeleton: 'There is growing concern that [clause].',
    slots: [{ key: 'clause', hintZh: '令人担忧的情况（从句）' }],
    glossZh: '引出社会担忧，适合 Task 2 开头或论证',
    exampleFilled:
      'There is growing concern that excessive screen time is harming teenagers’ mental health.',
  },
  {
    packId: FRAME_PACK_ID,
    title: 'It is widely argued that…',
    skeleton: 'It is widely argued that [clause].',
    slots: [{ key: 'clause', hintZh: '被广泛讨论的观点' }],
    glossZh: '引出常见观点，再给出自己立场',
    exampleFilled:
      'It is widely argued that universities should focus more on practical skills than theory.',
  },
  {
    packId: FRAME_PACK_ID,
    title: 'Play a pivotal role in…',
    skeleton: '[Subject] play(s) a pivotal role in [noun/-ing].',
    slots: [
      { key: 'Subject', hintZh: '主体' },
      { key: 'noun/-ing', hintZh: '领域或过程' },
    ],
    glossZh: '强调某因素的关键作用',
    exampleFilled: 'Education plays a pivotal role in reducing social inequality.',
  },
  {
    packId: FRAME_PACK_ID,
    title: 'Take … into account',
    skeleton: 'When evaluating [topic], we should take [factor] into account.',
    slots: [
      { key: 'topic', hintZh: '评价对象' },
      { key: 'factor', hintZh: '需考虑的因素' },
    ],
    glossZh: '论证时提醒需综合考虑',
    exampleFilled:
      'When evaluating urban planning, we should take environmental costs into account.',
  },
  {
    packId: FRAME_PACK_ID,
    title: 'On the one hand… on the other…',
    skeleton: 'On the one hand, [point A]. On the other hand, [point B].',
    slots: [
      { key: 'point A', hintZh: '一方面' },
      { key: 'point B', hintZh: '另一方面' },
    ],
    glossZh: '对比利弊或对立观点',
    exampleFilled:
      'On the one hand, remote work increases flexibility. On the other hand, it may weaken teamwork.',
  },
  {
    packId: FRAME_PACK_ID,
    title: 'This is not to say that…',
    skeleton: 'This is not to say that [clause]; rather, [clarification].',
    slots: [
      { key: 'clause', hintZh: '并非主张的内容' },
      { key: 'clarification', hintZh: '真正想强调的点' },
    ],
    glossZh: '让步后收束，避免绝对化',
    exampleFilled:
      'This is not to say that technology is useless; rather, its benefits depend on how it is used.',
  },
  {
    packId: FRAME_PACK_ID,
    title: 'In light of…',
    skeleton: 'In light of [evidence/noun], [conclusion].',
    slots: [
      { key: 'evidence/noun', hintZh: '依据' },
      { key: 'conclusion', hintZh: '由此得出的结论' },
    ],
    glossZh: '基于证据下结论，偏正式',
    exampleFilled:
      'In light of recent research, governments should invest more in early childhood education.',
  },
  {
    packId: FRAME_PACK_ID,
    title: 'A case in point is…',
    skeleton: 'A case in point is [example], which [explanation].',
    slots: [
      { key: 'example', hintZh: '具体例子' },
      { key: 'explanation', hintZh: '例子如何支撑论点' },
    ],
    glossZh: '举例论证的衔接句',
    exampleFilled:
      'A case in point is Singapore, which has invested heavily in public transport.',
  },
];

export function packItemToFrame(item: FramePackItem, id: string): Omit<Frame, 'createdAt'> {
  return {
    id,
    title: item.title,
    frameKey: normalizeFrameKey(item.skeleton),
    skeleton: item.skeleton,
    slots: item.slots,
    glossZh: item.glossZh,
    exampleFilled: item.exampleFilled,
    packId: item.packId,
    source: 'bank',
  };
}
