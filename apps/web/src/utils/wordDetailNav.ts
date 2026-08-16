import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';

/** 单词详情页 router state：区分列表浏览与关联词穿透 */
export type WordDetailNavState = {
  /** 入口页路径，一次返回应回到此处（练习页 / 词表等） */
  returnTo?: string;
  /** 从详情内穿透到另一词 → 返回时回到上一词而非 returnTo */
  drill?: boolean;
};

export function wordDetailEntryState(returnTo: string): WordDetailNavState {
  return { returnTo };
}

/** 列表内 prev/next 切换时保留入口 */
export function wordDetailBrowseState(
  current: WordDetailNavState | null | undefined
): WordDetailNavState | undefined {
  if (!current?.returnTo) return undefined;
  return { returnTo: current.returnTo };
}

/** 详情内点击近义/形近等穿透链接 */
export function wordDetailDrillLinkState(
  current: WordDetailNavState | null | undefined
): WordDetailNavState {
  return {
    returnTo: current?.returnTo,
    drill: true,
  };
}

export function useWordDetailEntryNav(): WordDetailNavState {
  const location = useLocation();
  return useMemo(
    () => wordDetailEntryState(location.pathname + location.search),
    [location.pathname, location.search]
  );
}

export function resolveWordDetailBack(
  state: WordDetailNavState | null | undefined,
  historyIdx: number | undefined,
  defaultPath = '/words'
): { type: 'back' } | { type: 'to'; path: string } {
  if (state?.drill) return { type: 'back' };
  if (state?.returnTo) return { type: 'to', path: state.returnTo };
  if (typeof historyIdx === 'number' && historyIdx > 0) return { type: 'back' };
  return { type: 'to', path: defaultPath };
}
