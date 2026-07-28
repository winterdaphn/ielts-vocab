import { useEffect, useState, type ReactNode } from 'react';
import { Button } from 'antd';

interface Props {
  title: string;
  /** Reset open state when this changes (e.g. word id) */
  sectionKey: string;
  /** Default collapsed / expanded */
  defaultOpen?: boolean;
  /** Called once when user expands (e.g. lazy-load AI tip) */
  onOpen?: () => void;
  children: ReactNode;
  className?: string;
}

/** Unified feedback tip block: title + 查看/收起 */
export default function CollapsibleTip({
  title,
  sectionKey,
  defaultOpen = false,
  onOpen,
  children,
  className = '',
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    setOpen(defaultOpen);
  }, [sectionKey, defaultOpen]);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    onOpen?.();
  }

  return (
    <div className={`suggestion tip-section ${className}`.trim()}>
      <div className="tip-section-head">
        <span className="tip-section-title">{title}</span>
        <Button
          type="text"
          size="small"
          className="tip-section-toggle"
          onClick={toggle}
        >
          {open ? '收起' : '查看'}
        </Button>
      </div>
      {open && <div className="tip-section-body">{children}</div>}
    </div>
  );
}
