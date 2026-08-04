import { Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { CloseOutlined, PlusOutlined } from '@ant-design/icons';
import { useCategories } from '@/store/useCategories';
import {
  categoryLabel,
  isFunctionCategory,
  isTopicCategory,
  migrateCategories,
  TOPIC_CATEGORIES,
  FUNCTION_CATEGORIES,
} from '@/config/categories';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

function removeTag(current: string[], name: string): string[] {
  return migrateCategories(current.filter((c) => c !== name));
}

function addTag(current: string[], name: string): string[] {
  if (current.includes(name)) return current;
  return migrateCategories([...current, name]);
}

function groupItems(
  label: string,
  names: readonly string[],
  selected: Set<string>
): NonNullable<MenuProps['items']>[number] | null {
  const children = names
    .filter((c) => !selected.has(c))
    .map((c) => ({ key: c, label: categoryLabel(c) }));
  if (!children.length) return null;
  return { type: 'group', label, children };
}

/** 已选标签 + × 移除；旁边 + 下拉添加 */
export default function WordCategoryEditor({ value, onChange, disabled }: Props) {
  const custom = useCategories((s) => s.custom);
  const selected = new Set(value);

  const menuItems: MenuProps['items'] = [
    groupItems('话题', TOPIC_CATEGORIES, selected),
    groupItems('功能', FUNCTION_CATEGORIES, selected),
    groupItems('自定义', custom, selected),
  ].filter((x): x is NonNullable<typeof x> => x != null);

  const canAdd = menuItems.length > 0;

  return (
    <div className="wd-cat-editor">
      <div className="wd-cat-editor-head">
        <h3>所属分组</h3>
        <span>{value.length ? `${value.length} 个` : '未分组'}</span>
      </div>

      <div className="wd-cat-selected">
        {value.map((c) => (
          <span
            key={c}
            className={`wd-cat-tag${isFunctionCategory(c) ? ' is-fn' : ''}${
              isTopicCategory(c) ? ' is-topic' : ''
            }`}
          >
            {categoryLabel(c)}
            {!disabled && (
              <button
                type="button"
                className="wd-cat-tag-x"
                aria-label={`移除 ${categoryLabel(c)}`}
                onClick={() => onChange(removeTag(value, c))}
              >
                <CloseOutlined />
              </button>
            )}
          </span>
        ))}

        {!disabled && (
          <Dropdown
            disabled={!canAdd}
            trigger={['click']}
            placement="bottomLeft"
            menu={{
              items: menuItems,
              onClick: ({ key }) => onChange(addTag(value, String(key))),
              style: { maxHeight: 280, overflowY: 'auto' },
            }}
          >
            <button
              type="button"
              className="wd-cat-add"
              aria-label="添加分组"
              disabled={!canAdd}
              title={canAdd ? '添加分组' : '没有可添加的分组'}
            >
              <PlusOutlined />
            </button>
          </Dropdown>
        )}
      </div>
    </div>
  );
}
