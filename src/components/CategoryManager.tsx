import { useState } from 'react';
import { Button, Input, Popconfirm, App, Tag } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { useCategories } from '@/store/useCategories';
import {
  TOPIC_CATEGORIES,
  FUNCTION_CATEGORIES,
  isPresetCategory,
  categoryLabel,
} from '@/config/categories';

function ChipList({
  groups,
  busy,
  onRemove,
}: {
  groups: readonly string[];
  busy: boolean;
  onRemove: (cat: string) => void;
}) {
  return (
    <div className="category-chip-list" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {groups.map((c) => {
        const preset = isPresetCategory(c);
        return (
          <Tag
            key={c}
            color={preset ? 'default' : 'green'}
            style={{ margin: 0, paddingInline: 8, lineHeight: '26px' }}
          >
            {categoryLabel(c)}
            {preset ? (
              <span style={{ marginLeft: 4, opacity: 0.45, fontSize: 11 }}>预置</span>
            ) : (
              <Popconfirm
                title={`删除分组「${categoryLabel(c)}」？`}
                description="会从所有单词上移除该分组"
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true, loading: busy }}
                onConfirm={() => onRemove(c)}
              >
                <button
                  type="button"
                  aria-label={`删除 ${categoryLabel(c)}`}
                  style={{
                    marginLeft: 6,
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    padding: 0,
                    color: 'inherit',
                    lineHeight: 1,
                  }}
                >
                  <DeleteOutlined style={{ fontSize: 11 }} />
                </button>
              </Popconfirm>
            )}
          </Tag>
        );
      })}
    </div>
  );
}

/** Manage custom word groups (preset topic + function are listed but not deletable). */
export default function CategoryManager() {
  const { message } = App.useApp();
  const custom = useCategories((s) => s.custom);
  const addCustom = useCategories((s) => s.addCustom);
  const removeCustom = useCategories((s) => s.removeCustom);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  function handleAdd() {
    const res = addCustom(name);
    if (!res.ok) {
      message.warning(res.error || '添加失败');
      return;
    }
    setName('');
    message.success('已添加分组');
  }

  async function handleRemove(cat: string) {
    setBusy(true);
    try {
      const res = await removeCustom(cat);
      if (!res.ok) {
        message.warning(res.error || '删除失败');
        return;
      }
      message.success(`已删除分组「${categoryLabel(cat)}」`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-card">
      <h3 style={{ fontSize: 14, marginBottom: 8 }}>单词分组</h3>
      <p style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 12, lineHeight: 1.55 }}>
        预置含话题与功能标签，可任意多选打标；自定义分组可增删。
      </p>

      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--text)' }}>
        话题
      </div>
      <ChipList groups={TOPIC_CATEGORIES} busy={busy} onRemove={handleRemove} />

      <div style={{ fontSize: 12, fontWeight: 600, margin: '14px 0 8px', color: 'var(--text)' }}>
        功能
      </div>
      <ChipList groups={FUNCTION_CATEGORIES} busy={busy} onRemove={handleRemove} />

      {custom.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, margin: '14px 0 8px', color: 'var(--text)' }}>
            自定义
          </div>
          <ChipList groups={custom} busy={busy} onRemove={handleRemove} />
        </>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <Input
          value={name}
          maxLength={24}
          placeholder="新自定义分组名"
          onChange={(e) => setName(e.target.value)}
          onPressEnter={handleAdd}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          添加
        </Button>
      </div>
    </div>
  );
}
