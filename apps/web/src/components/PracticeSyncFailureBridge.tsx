import { useEffect } from 'react';
import { App } from 'antd';
import { setPracticeSyncFailureHandler } from '@/utils/practiceSyncDebug';

/** 练习云端同步失败 → antd toast（成功不提示） */
export default function PracticeSyncFailureBridge() {
  const { message } = App.useApp();

  useEffect(() => {
    setPracticeSyncFailureHandler((text) => {
      message.warning(text, 5);
    });
    return () => setPracticeSyncFailureHandler(null);
  }, [message]);

  return null;
}
