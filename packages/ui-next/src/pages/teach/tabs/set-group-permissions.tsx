import { useId, useState } from 'react';
import { BookOpen, ChevronRight, Eye, ListChecks, Plus, UsersRound, UserRound } from 'lucide-react';
import {
  SET_DEFAULT_PERMISSIONS,
  SET_PROBLEM_PERMISSIONS,
  SET_RECORD_PERMISSIONS,
  type SetAuthorization,
  type SetPermissions,
} from '@hydrooj/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { confirmDialog } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form';
import { Panel } from '@/components/ui/panel';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { SimpleSelect } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { SettingsResponse } from './set-settings-model';

const problemChoices = {
  hidden: ['不可见', '学生看不到题目。'],
  view: ['可查看', '可以阅读题目，不能作答。'],
  answer: ['可作答', '可以阅读题目并提交答案。'],
} as const;
const recordChoices = {
  self: ['仅看自己', '只能查看自己的提交记录和详情。'],
  list: ['列出所有', '可看所有人的提交列表，只能打开自己的详情和代码。'],
  details: ['查看所有明细与代码', '可以打开其他学生的提交详情并阅读代码。'],
} as const;
const recordSummaries: Record<SetPermissions['records'], string> = {
  self: '仅看自己的提交',
  list: '可看他人提交列表',
  details: '可看他人详情与代码',
};

function PermissionChoices<T extends string>({
  label,
  values,
  choices,
  value,
  onChange,
}: {
  label: string;
  values: readonly T[];
  choices: Record<T, readonly [string, string]>;
  value: T;
  onChange: (next: T) => void;
}) {
  const name = useId();
  return (
    <RadioGroup aria-label={label} className="gap-1">
      {values.map((item) => (
        <RadioGroupItem
          key={item}
          name={name}
          value={item}
          checked={item === value}
          label={choices[item][0]}
          description={choices[item][1]}
          onChange={() => onChange(item)}
          wrapperClassName="rounded-md px-3 py-2 hover:bg-surface-hover has-checked:bg-brand-soft"
        />
      ))}
    </RadioGroup>
  );
}

function PermissionSwitch({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-fg">{label}</span>
        <span className="mt-0.5 block text-xs text-fg-muted">{description}</span>
      </span>
      <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

export function SetGroupPermissions({
  policy,
  savedPolicy,
  catalog,
  onChange,
}: {
  policy?: SetAuthorization;
  savedPolicy: boolean;
  catalog: SettingsResponse['groups'];
  onChange: (next: SetAuthorization) => void;
}) {
  const [editingId, setEditingId] = useState('');
  const [addingId, setAddingId] = useState('');
  const addSelectId = useId();
  const defaults = policy?.defaults ?? SET_DEFAULT_PERMISSIONS;
  const groups = policy?.groups ?? [];
  const names = new Map(catalog.map((group) => [group.id, group.name]));
  const configured = new Map(groups.map((group) => [group.groupId, group]));
  const targets = [
    { value: '', label: '默认权限', hint: policy ? recordSummaries[defaults.records] : undefined },
    ...groups.map(({ groupId, records }) => ({ value: groupId, label: names.get(groupId) ?? '已删除的组', hint: recordSummaries[records] })),
  ];
  const available = catalog.filter((group) => group.attachable && !configured.has(group.id));
  const selected = configured.get(editingId);
  const activeId = selected?.groupId ?? '';
  const title = selected ? (names.get(selected.groupId) ?? '已删除的组') : '默认权限';
  const value = selected ?? defaults;
  const adding = available.find((group) => group.id === addingId);
  function update(next: SetPermissions) {
    if (!selected) onChange({ defaults: next, groups });
    else onChange({ defaults, groups: groups.map((group) => (group.groupId === selected.groupId ? { ...group, ...next } : group)) });
  }

  return (
    <div className="flex min-w-0 flex-col items-stretch gap-4 lg:flex-row lg:items-start">
      <Panel
        title="授权对象"
        description="授权仅对「学生」页参与范围内的学生生效。"
        className="lg:w-72 lg:shrink-0"
        flush
        footer={
          available.length ? (
            <FormField label="添加用户组授权" htmlFor={addSelectId}>
              <div className="flex min-w-0 items-center gap-2">
                <SimpleSelect
                  id={addSelectId}
                  ariaLabel="选择用户组"
                  value={adding?.id ?? ''}
                  onValueChange={setAddingId}
                  className="min-w-0 flex-1"
                  options={[{ value: '', label: '选择用户组', disabled: true }, ...available.map(({ id, name }) => ({ value: id, label: name }))]}
                />
                <Button
                  variant="secondary"
                  disabled={!adding}
                  onClick={() => {
                    if (!adding) return;
                    onChange({ defaults, groups: [...groups, { ...defaults, groupId: adding.id }] });
                    setEditingId(adding.id);
                    setAddingId('');
                  }}
                >
                  <Plus aria-hidden="true" />
                  添加授权
                </Button>
              </div>
            </FormField>
          ) : (
            <p className="text-xs text-fg-muted">
              {catalog.some((group) => group.attachable) ? '所有可用用户组均已添加。' : '当前没有可添加的用户组。'}
            </p>
          )
        }
      >
        {groups.length > 0 ? (
          <div className="p-3 lg:hidden">
            <SimpleSelect ariaLabel="正在编辑的授权对象" value={activeId} options={targets} onValueChange={setEditingId} />
          </div>
        ) : null}
        <nav aria-label="授权对象" className="hidden max-h-96 space-y-1 overflow-y-auto p-2 lg:block">
          {targets.map((target) => (
            <Button
              key={target.value}
              variant={activeId === target.value ? 'soft' : 'ghost'}
              aria-label={target.label}
              aria-description={target.hint}
              aria-pressed={activeId === target.value}
              onClick={() => setEditingId(target.value)}
              className="h-auto min-h-10 w-full justify-start whitespace-normal px-3 py-2 text-left"
            >
              {target.value ? <UsersRound aria-hidden="true" /> : <UserRound aria-hidden="true" />}
              <span className="min-w-0 flex-1 break-words">
                {target.label}
                {target.hint ? <span className="mt-0.5 block text-xs font-normal text-fg-muted">{target.hint}</span> : null}
              </span>
              {activeId === target.value ? <ChevronRight aria-hidden="true" /> : null}
            </Button>
          ))}
        </nav>
      </Panel>
      <Panel
        className="min-w-0 flex-1"
        flush
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 break-words">{title}</span>
            {!selected ? (
              <Badge tone={savedPolicy ? 'success' : 'neutral'} variant="outline">
                {savedPolicy ? '已启用分组授权' : policy ? '分组授权待保存' : '沿用题目集规则'}
              </Badge>
            ) : null}
          </span>
        }
        description={
          selected
            ? '仅影响本组学生在这个题目集中的权限。'
            : policy
              ? '未单独授权的学生使用这组权限。'
              : '下方是启用后的默认值。修改任一权限或添加用户组也会启用分组授权。'
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="max-w-prose text-xs text-fg-muted">学生属于多个授权组时，各项分别取最高权限。反馈时间和封榜规则仍然生效。</p>
            {!policy ? (
              <Button size="sm" onClick={() => onChange({ defaults, groups })}>
                启用分组授权
              </Button>
            ) : null}
            {selected ? (
              <Button
                size="sm"
                variant="danger-soft"
                onClick={async () => {
                  if (
                    await confirmDialog('本组学生将使用其他匹配组的权限，未匹配时使用默认权限。', {
                      title: `移除「${title}」的授权？`,
                      destructive: true,
                      confirmLabel: '移除授权',
                    })
                  ) {
                    onChange({ defaults, groups: groups.filter((group) => group.groupId !== selected.groupId) });
                    setEditingId('');
                  }
                }}
              >
                移除授权
              </Button>
            ) : null}
          </div>
        }
      >
        <div className="grid min-w-0 sm:grid-cols-2 3xl:grid-cols-3">
          <div className="min-w-0 space-y-2 p-4">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-fg">
              <BookOpen aria-hidden="true" className="size-4 text-fg-muted" />
              题目权限
            </h4>
            <PermissionChoices
              label="题目权限"
              values={SET_PROBLEM_PERMISSIONS}
              choices={problemChoices}
              value={value.problems}
              onChange={(problems) => update({ ...value, problems })}
            />
          </div>
          <div className="min-w-0 space-y-2 border-t border-line-subtle p-4 sm:border-t-0 sm:border-l">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-fg">
              <ListChecks aria-hidden="true" className="size-4 text-fg-muted" />
              提交列表权限
            </h4>
            <PermissionChoices
              label="提交列表权限"
              values={SET_RECORD_PERMISSIONS}
              choices={recordChoices}
              value={value.records}
              onChange={(records) => update({ ...value, records })}
            />
          </div>
          <div className="min-w-0 border-t border-line-subtle p-4 sm:col-span-2 3xl:col-span-1 3xl:border-t-0 3xl:border-l">
            <h4 className="mb-4 hidden items-center gap-2 text-sm font-semibold text-fg 3xl:flex">
              <Eye aria-hidden="true" className="size-4 text-fg-muted" />
              排名与考后查看
            </h4>
            <div className="grid min-w-0 gap-5 sm:grid-cols-2 sm:gap-8 3xl:grid-cols-1 3xl:gap-5">
              <PermissionSwitch
                label="可查看排名"
                description="按本题目集的排名开放时间展示。"
                checked={value.scoreboard}
                onChange={(scoreboard) => update({ ...value, scoreboard })}
              />
              <PermissionSwitch
                label="结束后保持查看权限"
                description="结束后仍可按这些权限查看题目、提交和排名。"
                checked={value.afterEnd}
                onChange={(afterEnd) => update({ ...value, afterEnd })}
              />
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}
