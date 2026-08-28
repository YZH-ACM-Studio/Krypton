import { useState } from 'react';
import { DomainUserSearchOption, domainUserSearchLabel, loadDomainUsers, type DomainUserOption } from '@/components/domain-user-search';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MultiSelect } from '@/components/ui/multi-select';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import type { CourseRecord } from './types';

export interface CourseAssignSnapshot {
  expectedOwner: number;
  owner: DomainUserOption;
  maintainers: DomainUserOption[];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function parseAssignUser(value: unknown): DomainUserOption {
  if (!value || typeof value !== 'object') throw new Error('课程分配失败');
  const record = value as Record<string, unknown>;
  if (!Number.isSafeInteger(record._id) || Number(record._id) < 1) throw new Error('课程分配失败');
  return {
    _id: Number(record._id),
    ...(optionalString(record.uname) ? { uname: optionalString(record.uname) } : {}),
    ...(optionalString(record.displayName) ? { displayName: optionalString(record.displayName) } : {}),
    ...(optionalString(record.mail) ? { mail: optionalString(record.mail) } : {}),
    ...(optionalString(record.avatarUrl) ? { avatarUrl: optionalString(record.avatarUrl) } : {}),
    ...(optionalString(record.studentId) ? { studentId: optionalString(record.studentId) } : {}),
    ...(optionalString(record.realName) ? { realName: optionalString(record.realName) } : {}),
  };
}

function parseAssignResult(value: unknown): CourseAssignSnapshot {
  if (!value || typeof value !== 'object') throw new Error('课程分配失败');
  const body = value as { ok?: unknown; expectedOwner?: unknown; owner?: unknown; maintainers?: unknown };
  if (body.ok !== true) throw new Error('课程分配失败');
  const expectedOwner = Number(body.expectedOwner);
  if (!Number.isSafeInteger(expectedOwner) || expectedOwner < 1) throw new Error('课程分配失败');
  const owner = parseAssignUser(body.owner);
  if (owner._id !== expectedOwner) throw new Error('课程分配失败');
  if (!Array.isArray(body.maintainers)) throw new Error('课程分配失败');
  return {
    expectedOwner,
    owner,
    maintainers: body.maintainers.map(parseAssignUser),
  };
}

export async function saveCourseAssignment(action: string, expectedOwner: number, owner: DomainUserOption, maintainers: DomainUserOption[]) {
  if (!Number.isSafeInteger(owner._id) || owner._id < 1) throw new Error('课程负责人无效');
  const body = new URLSearchParams({
    operation: 'assign',
    expectedOwner: String(expectedOwner),
    owner: String(owner._id),
  });
  for (const user of maintainers) {
    if (user._id === owner._id) continue;
    body.append('maintainer', String(user._id));
  }
  const response = await fetchHydroResponse(action, {
    method: 'POST',
    body,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(await readHydroResponseError(response, '课程分配失败'));
  return parseAssignResult(await response.json());
}

export function CourseAssignForm({
  domainId,
  action,
  expectedOwner,
  initialOwner,
  initialMaintainers,
  onAssigned,
}: {
  domainId: string;
  action: string;
  expectedOwner: number;
  initialOwner: DomainUserOption | null;
  initialMaintainers: DomainUserOption[];
  onAssigned?: (next: CourseAssignSnapshot) => void;
}) {
  const [owner, setOwner] = useState<DomainUserOption[]>(initialOwner ? [initialOwner] : []);
  const [maintainers, setMaintainers] = useState<DomainUserOption[]>(initialMaintainers);
  const [currentExpected, setCurrentExpected] = useState(expectedOwner);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const submit = async () => {
    const nextOwner = owner[0];
    if (!nextOwner) {
      setError('课程负责人无效');
      return;
    }
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const result = await saveCourseAssignment(action, currentExpected, nextOwner, maintainers);
      setCurrentExpected(result.expectedOwner);
      setOwner([result.owner]);
      setMaintainers(result.maintainers);
      setSaved(true);
      onAssigned?.(result);
    } catch (cause) {
      setError((cause as { message?: string } | null)?.message || '课程分配失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="space-y-3"
      onChange={(event) => event.stopPropagation()}
      onInput={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <label className="block space-y-1.5">
        <span className="text-xs font-medium">课程负责人</span>
        <MultiSelect<DomainUserOption>
          value={owner}
          onChange={setOwner}
          loadOptions={(query) => loadDomainUsers(domainId, query)}
          getKey={(item) => String(item._id)}
          getLabel={domainUserSearchLabel}
          renderChip={(item) => <span>{item.displayName || item.uname || `UID ${item._id}`}</span>}
          renderOption={(item) => <DomainUserSearchOption user={item} />}
          maxItems={1}
          placeholder="搜索 UID / OJ 用户 / 学号 / 姓名"
          emptyText="没有匹配的用户"
        />
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium">协作教师</span>
        <MultiSelect<DomainUserOption>
          value={maintainers}
          onChange={setMaintainers}
          loadOptions={(query) => loadDomainUsers(domainId, query)}
          getKey={(item) => String(item._id)}
          getLabel={domainUserSearchLabel}
          renderChip={(item) => <span>{item.displayName || item.uname || `UID ${item._id}`}</span>}
          renderOption={(item) => <DomainUserSearchOption user={item} />}
          placeholder="可选，搜索后添加"
          emptyText="没有匹配的用户"
        />
      </label>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {saved ? <p className="text-xs text-emerald-700 dark:text-emerald-400">分配已保存。课件权限跟随新的负责人和协作教师。</p> : null}
      <Button type="button" className="min-h-11 w-full" disabled={busy || owner.length !== 1} onClick={submit}>
        {busy ? '保存中' : '保存分配'}
      </Button>
    </div>
  );
}

export function CourseAssignDialog({
  open,
  onOpenChange,
  domainId,
  course,
  users,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  domainId: string;
  course: CourseRecord;
  users: Record<string, DomainUserOption>;
}) {
  const tid = String(course.docId || course._id || '');
  const ownerId = Number(course.owner);
  const owner = Number.isSafeInteger(ownerId) && ownerId >= 1 ? users[String(ownerId)] || { _id: ownerId, uname: `UID ${ownerId}` } : null;
  const maintainers = (course.maintainer || [])
    .map(Number)
    .filter((uid) => Number.isSafeInteger(uid) && uid >= 1 && uid !== ownerId)
    .map((uid) => users[String(uid)] || { _id: uid, uname: `UID ${uid}` });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>分配课程</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3 px-6 py-4">
          <p className="text-sm text-muted-foreground">
            把「{course.title || '未命名课程'}」转给指定教师。负责人和协作教师都可以编辑内容并管理课件。
          </p>
          {owner ? (
            <CourseAssignForm
              domainId={domainId}
              action={`/course/${tid}/edit`}
              expectedOwner={ownerId}
              initialOwner={owner}
              initialMaintainers={maintainers}
              onAssigned={() => {
                onOpenChange(false);
                window.location.reload();
              }}
            />
          ) : (
            <p role="alert" className="text-sm text-destructive">
              课程负责人无效
            </p>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
