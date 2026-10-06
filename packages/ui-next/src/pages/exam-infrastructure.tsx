import { useEffect, useState, type FormEvent } from 'react';
import { ChevronRight, FileClock, Plus } from 'lucide-react';
import { AdminPage } from '@/components/admin/admin-page';
import { ForbiddenPanel } from '@/components/admin/forbidden';
import { type DomainUserOption } from '@/components/domain-user-search';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField, FormRow } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { SimpleSelect } from '@/components/ui/select';
import { useBootstrap } from '@/lib/bootstrap';
import { ClassroomLauncher } from '@/pages/exam-classroom';
import { EventDetailPage } from './exam-event/event-detail';
import {
  apiObject,
  asRecord,
  asString,
  formatDate,
  parseEvent,
  postJson,
  type EventType,
  type ExamEventView,
  type SchoolView,
} from './exam-event/model';
import { CollaboratorSelect, ContestSearchSelect, MutationNotice, statusBadge } from './exam-event/shared';

function EventCreateDialog({ open, schools, onClose }: { open: boolean; schools: SchoolView[]; onClose: () => void }) {
  const bs = useBootstrap();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<EventType>('external');
  const [contestId, setContestId] = useState('');
  const [collaborators, setCollaborators] = useState<DomainUserOption[]>([]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const body: Record<string, unknown> = {
        schoolId: String(form.get('schoolId') || ''),
        title: String(form.get('title') || ''),
        type,
        startAt: new Date(String(form.get('startAt') || '')).toISOString(),
        endAt: new Date(String(form.get('endAt') || '')).toISOString(),
        collaboratorUids: collaborators.map((user) => user._id),
      };
      if (type === 'krypton' && contestId.trim()) body.contestId = contestId.trim();
      const payload = await postJson('/api/admin/exam-events', body, '创建考试活动失败');
      const created = parseEvent(payload.event);
      window.location.assign(`/admin/exam-infrastructure/events/${created.eventId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建考试活动失败');
      setBusy(false);
    }
  };
  const close = () => {
    if (busy) return;
    setType('external');
    setContestId('');
    setCollaborators([]);
    setError(null);
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent size="lg" onClose={busy ? undefined : close}>
        <form onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>新建考试活动</DialogTitle>
            <p className="mt-1 text-sm text-fg-muted">Krypton 比赛和纯外部考试共用同一套基础设施流程。</p>
          </DialogHeader>
          <DialogBody className="space-y-5">
            <MutationNotice error={error} />
            <FormRow columns={2}>
              <FormField label="活动名称" htmlFor="new-exam-title" required>
                <Input id="new-exam-title" name="title" required maxLength={120} autoFocus />
              </FormField>
              <FormField label="学校" htmlFor="new-exam-school" required>
                <SimpleSelect
                  id="new-exam-school"
                  name="schoolId"
                  required
                  ariaLabel="学校"
                  defaultValue=""
                  placeholder="请选择学校"
                  options={[{ value: '', label: '请选择学校' }, ...schools.map((school) => ({ value: school.schoolId, label: school.name }))]}
                />
              </FormField>
              <FormField label="考试类型" htmlFor="new-exam-type" required>
                <SimpleSelect
                  id="new-exam-type"
                  ariaLabel="考试类型"
                  value={type}
                  onValueChange={(next) => {
                    const resolved = next as EventType;
                    setType(resolved);
                    if (resolved === 'external') setContestId('');
                  }}
                  options={[
                    { value: 'external', label: '外部考试' },
                    { value: 'krypton', label: 'Krypton 比赛' },
                  ]}
                />
              </FormField>
              {type === 'krypton' ? (
                <FormField label="Krypton 比赛" required hint="按标题搜索并选择比赛；可先建草稿再关联。">
                  <ContestSearchSelect name="contestId" value={contestId} onChange={(next) => setContestId(next)} />
                </FormField>
              ) : null}
              <FormField label="开始时间" htmlFor="new-exam-start" required>
                <Input id="new-exam-start" name="startAt" type="datetime-local" required />
              </FormField>
              <FormField label="硬截止时间" htmlFor="new-exam-end" required>
                <Input id="new-exam-end" name="endAt" type="datetime-local" required />
              </FormField>
            </FormRow>
            <FormField label="协作者" hint="可选；服务端会重新校验学校范围。">
              <CollaboratorSelect domainId={bs.domain.id} value={collaborators} onChange={setCollaborators} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={busy} onClick={close}>
              取消
            </Button>
            <Button type="submit" variant="primary" disabled={busy} loading={busy}>
              <Plus />
              创建活动
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EventListPage() {
  const [events, setEvents] = useState<ExamEventView[]>([]);
  const [schools, setSchools] = useState<SchoolView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    let current = true;
    void apiObject('/api/admin/exam-events', undefined, '加载考试活动失败')
      .then((payload) => {
        if (!current) return;
        if (!Array.isArray(payload.events) || !Array.isArray(payload.schools)) throw new Error('考试活动响应格式不正确');
        setEvents(payload.events.map(parseEvent));
        setSchools(
          payload.schools.map((item) => {
            const school = asRecord(item, '学校');
            return { schoolId: asString(school.schoolId, '学校'), name: asString(school.name, '学校') };
          }),
        );
      })
      .catch((cause) => current && setError(cause instanceof Error ? cause.message : '加载考试活动失败'))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, []);
  return (
    <AdminPage
      bypassPrivGate
      hideSidebar
      contentClassName="min-w-0 overflow-x-clip"
      title="考试基础设施"
      description="统一管理 Krypton 比赛与外部考试的网络策略、目标终端和真实执行结果。"
      actions={
        !loading && !error ? (
          <>
            <ClassroomLauncher schools={schools} />
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus />
              新建活动
            </Button>
          </>
        ) : undefined
      }
    >
      {error ? (
        <MutationNotice error={error} />
      ) : loading ? (
        <div className="flex min-h-48 items-center justify-center">
          <Spinner className="size-6 text-fg-subtle" />
        </div>
      ) : events.length ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {events.map((event) => (
            <a
              key={event.eventId}
              href={`/admin/exam-infrastructure/events/${event.eventId}`}
              className="group block min-w-0 rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Panel
                as="div"
                className="h-full transition-[border-color,box-shadow] duration-(--dur-1) ease-(--ease-standard) group-hover:border-line-strong group-hover:shadow-sm"
                title={
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate">{event.title}</span>
                    {statusBadge(event.status)}
                    <Badge variant="outline">{event.type === 'krypton' ? 'Krypton' : '外部考试'}</Badge>
                  </span>
                }
                actions={<ChevronRight className="size-4 text-fg-subtle" aria-hidden="true" />}
              >
                <p className="text-sm text-fg-muted">
                  {schools.find((school) => school.schoolId === event.schoolId)?.name || '学校未登记'}
                </p>
                <p className="mt-1 text-sm text-fg-muted">
                  {formatDate(event.startAt)} → {formatDate(event.endAt)}
                </p>
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-fg-subtle">
                  <span>活动版本 {event.revision}</span>
                  <span>负责人 UID {event.ownerUid}</span>
                  <span>{event.collaboratorUids.length} 名协作者</span>
                </div>
              </Panel>
            </a>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<FileClock />}
          title="还没有考试活动"
          description="先创建外部考试或关联 Krypton 比赛，再逐步配置网络策略和目标终端。"
          action={
            <Button variant="secondary" onClick={() => setCreating(true)}>
              <Plus />
              创建第一个活动
            </Button>
          }
        />
      )}
      <EventCreateDialog open={creating} schools={schools} onClose={() => setCreating(false)} />
    </AdminPage>
  );
}

export function ExamInfrastructurePage() {
  const bs = useBootstrap();
  if (!bs.user.canManageExamInfrastructure) return <ForbiddenPanel message="你没有管理考试基础设施的权限。" />;
  const data = asRecord(bs.page.data, '考试基础设施页面');
  if (data.eventId !== null) throw new Error('考试基础设施列表页响应格式不正确');
  return <EventListPage />;
}

export function ExamEventPage() {
  const bs = useBootstrap();
  if (!bs.user.canManageExamInfrastructure) return <ForbiddenPanel message="你没有管理考试基础设施的权限。" />;
  const data = asRecord(bs.page.data, '考试活动页面');
  const eventId = asString(data.eventId, '考试活动页面');
  if (!eventId) throw new Error('考试活动页面响应格式不正确');
  return <EventDetailPage eventId={eventId} />;
}
