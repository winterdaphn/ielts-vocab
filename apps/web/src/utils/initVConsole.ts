let installed = false;
const DEBUG_KEY = 'iv-debug';

/** 仅 URL ?debug=1 或已手动开启时加载 vConsole（移动端/PC 一致） */
function shouldEnableVConsole(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    const debugParam = params.get('debug');
    if (debugParam === '1') {
      sessionStorage.setItem(DEBUG_KEY, '1');
      return true;
    }
    if (debugParam === '0') {
      sessionStorage.removeItem(DEBUG_KEY);
      localStorage.removeItem(DEBUG_KEY);
      return false;
    }
    if (sessionStorage.getItem(DEBUG_KEY) === '1') return true;
    if (localStorage.getItem(DEBUG_KEY) === '1') return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** ?debug=1 时加载 vConsole；同标签页内跳转仍保持，关标签即失效 */
export async function initVConsoleIfNeeded(): Promise<void> {
  if (installed || !shouldEnableVConsole()) return;
  installed = true;

  const { default: VConsole } = await import('vconsole');
  new VConsole({ theme: 'dark' });
}

/** 持久开启（跨标签/重启仍有效）；一般只用 ?debug=1 即可 */
export function persistDebugConsole() {
  try {
    localStorage.setItem(DEBUG_KEY, '1');
    sessionStorage.setItem(DEBUG_KEY, '1');
  } catch {
    /* ignore */
  }
}
