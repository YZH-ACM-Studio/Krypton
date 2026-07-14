import { ChevronDown, Tag } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { SimpleSelect } from '@/components/ui/select';

type R = Record<string, any>;

export interface KnowledgeMindmapOption {
  id: string;
  label: string;
  tags: string[];
  invalid?: boolean;
}

interface StructuredProblemMetadataPanelProps {
  pdoc: R;
  isCreate: boolean;
  locked: boolean;
  mindmapOptions: KnowledgeMindmapOption[];
  canUseCustomPid: boolean;
  onMetadataChange: () => void;
  children?: ReactNode;
}

const DIFFICULTY_OPTIONS = [
  { value: '0', label: '未评定' },
  { value: '1', label: '入门' },
  { value: '2', label: '普及−' },
  { value: '3', label: '普及/提高−' },
  { value: '4', label: '普及+/提高' },
  { value: '5', label: '提高+/省选−' },
  { value: '6', label: '省选/NOI−' },
  { value: '7', label: '省选/NOI' },
  { value: '8', label: 'NOI/NOI+' },
  { value: '9', label: 'NOI+/CTSC' },
  { value: '10', label: 'CTSC/IOI' },
];

function objectIdString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof (value as R).$oid === 'string') return (value as R).$oid;
  return String(value || '');
}

export function StructuredProblemMetadataPanel({
  pdoc,
  isCreate,
  locked,
  mindmapOptions,
  canUseCustomPid,
  onMetadataChange,
  children,
}: StructuredProblemMetadataPanelProps) {
  const initialKnowledge = useMemo(() => {
    const selectedIds = (Array.isArray(pdoc.knowledgeNodeIds) ? pdoc.knowledgeNodeIds : []).map(objectIdString).filter(Boolean);
    const byId = new Map(mindmapOptions.map((option) => [option.id, option]));
    return selectedIds.map(
      (id): KnowledgeMindmapOption =>
        byId.get(id) || {
          id,
          label: `已失效的知识节点 · ${id}`,
          tags: [],
          invalid: true,
        },
    );
  }, [mindmapOptions, pdoc.knowledgeNodeIds]);
  const [selectedKnowledge, setSelectedKnowledge] = useState<KnowledgeMindmapOption[]>(initialKnowledge);
  const [title, setTitle] = useState(String(pdoc.title || ''));
  const [titleTouched, setTitleTouched] = useState(false);
  const hasInvalidKnowledge = selectedKnowledge.some((option) => option.invalid);
  const displayPid = typeof pdoc.pid === 'string' ? pdoc.pid : pdoc.docId ? `P${pdoc.docId}` : '';

  return (
    <aside className="space-y-5 lg:border-l lg:border-border/70 lg:pl-5" aria-label="题目元数据">
      <label className="block space-y-1.5">
        <span className="text-xs font-medium">标题</span>
        <Input
          name="title"
          value={title}
          required
          pattern=".*\S.*"
          aria-invalid={titleTouched && !title.trim() ? true : undefined}
          onBlur={(event) => setTitleTouched(!event.currentTarget.value.trim())}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setTitle(next);
            event.currentTarget.setCustomValidity(next.trim() ? '' : '请输入题目标题');
            if (titleTouched && next.trim()) setTitleTouched(false);
          }}
          onInvalid={(event) => {
            event.currentTarget.setCustomValidity(event.currentTarget.value.trim() ? '' : '请输入题目标题');
            setTitleTouched(true);
          }}
          className="min-h-11"
        />
        {titleTouched ? (
          <span role="alert" className="text-xs text-destructive">
            标题不能为空。
          </span>
        ) : null}
      </label>

      <section className="space-y-1.5" aria-labelledby="structured-pid-label">
        <span id="structured-pid-label" className="text-xs font-medium">
          题目编号
        </span>
        {canUseCustomPid ? (
          <details className="group border-y border-border/70 py-2">
            <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between text-xs text-muted-foreground">
              <span>{isCreate ? '自动分配；管理员可展开自定义' : displayPid || '自动编号'}</span>
              <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <Input
              name="pid"
              defaultValue={typeof pdoc.pid === 'string' ? pdoc.pid : ''}
              placeholder="留空自动分配，如 P1001"
              pattern="^(?:[a-z0-9]{1,10}-)?[a-zA-Z][a-zA-Z0-9]*$"
              disabled={locked}
              className="mt-2 min-h-11"
            />
          </details>
        ) : (
          <p className="border-y border-border/70 py-3 text-xs text-muted-foreground">
            {isCreate ? '保存时由系统自动分配' : displayPid || '系统自动编号'}
          </p>
        )}
      </section>

      <section className="space-y-1.5" role="group" aria-labelledby="structured-knowledge-label">
        <span id="structured-knowledge-label" className="flex items-center gap-1 text-xs font-medium">
          <Tag className="size-3.5" aria-hidden="true" />
          知识标签
        </span>
        <MultiSelect<KnowledgeMindmapOption>
          options={mindmapOptions}
          value={selectedKnowledge}
          onChange={(next) => {
            setSelectedKnowledge(next);
            onMetadataChange();
          }}
          getKey={(option) => option.id}
          getLabel={(option) => option.label}
          getDescription={(option) => (option.invalid ? '节点已失效，请移除并重新选择' : option.tags.join(' / '))}
          renderChip={(option) => <span className={option.invalid ? 'text-destructive' : undefined}>{option.label}</span>}
          name="knowledgeNodeIds"
          placeholder="从知识导图选择，可多选"
          emptyText="没有匹配的知识节点"
          minHeight={44}
        />
        <p className="text-xs text-muted-foreground">保存时由服务端重新物化所选节点及其带标签祖先；不接受自由标签。</p>
        {hasInvalidKnowledge ? (
          <p role="alert" className="text-xs text-destructive">
            原选择中有已删除或不可选的节点；请移除并重新选择后再保存。
          </p>
        ) : null}
      </section>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium">难度</span>
        <SimpleSelect name="difficulty" defaultValue={String(pdoc.difficulty || 0)} options={DIFFICULTY_OPTIONS} onValueChange={onMetadataChange} />
      </label>

      {isCreate ? (
        <p className="border-y border-border/70 py-3 text-xs text-muted-foreground">新题首次保存固定为隐藏，检查完成后再发布。</p>
      ) : (
        <label className="flex min-h-11 cursor-pointer items-center gap-2 border-y border-border/70 py-2 text-sm">
          <Checkbox name="hidden" defaultChecked={!!pdoc.hidden} />
          <span>隐藏题目</span>
        </label>
      )}
      {locked ? (
        <p className="border-y border-amber-300 py-3 text-xs text-amber-800 dark:border-amber-900 dark:text-amber-200">
          题目结构已锁定；本侧元数据仍可保存，但题号不可修改。
        </p>
      ) : null}
      {children}
    </aside>
  );
}
