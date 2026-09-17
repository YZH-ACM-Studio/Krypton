import { KeyRound, Pencil, Trash2, Unlink } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { TableAction, TableActions } from '@/components/ui/table-actions';

export interface RosterStudentRow {
  _id: string;
  studentId: string;
  realName: string;
  boundUserId?: number | null;
  enrollmentYear?: number | null;
}

export function currentUserbindReturnTo(fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const path = `${window.location.pathname}${window.location.search}`;
  return path.startsWith('/admin/userbind') ? path : fallback;
}

export function StudentRosterActions({
  student,
  returnTo,
  showInviteToken = true,
}: {
  student: RosterStudentRow;
  returnTo: string;
  showInviteToken?: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const bound = !!(student.boundUserId && student.boundUserId > 0);

  return (
    <>
      <TableActions>
        <TableAction onClick={() => setEditOpen(true)} icon={Pencil}>
          编辑
        </TableAction>
        {bound ? (
          <TableAction
            formAction="/admin/userbind/students"
            variant="destructive"
            icon={Unlink}
            confirm={`确认解绑学号「${student.studentId}」当前绑定的账号 UID ${student.boundUserId}？解绑后该账号将不再关联此学生记录。`}
            hidden={{
              operation: 'unbind',
              studentRecordId: student._id,
              expectedBoundUserId: student.boundUserId!,
              returnTo,
            }}
          >
            解绑
          </TableAction>
        ) : (
          <>
            {showInviteToken ? (
              <TableAction
                formAction="/admin/userbind/students"
                icon={KeyRound}
                hidden={{ operation: 'generateStudentToken', studentRecordId: student._id }}
              >
                单人令牌
              </TableAction>
            ) : null}
            <TableAction
              formAction="/admin/userbind/students"
              variant="destructive"
              icon={Trash2}
              confirm={`确认删除未绑定的学生记录「${student.studentId}」？此操作无法恢复。`}
              hidden={{ operation: 'deleteStudent', studentRecordId: student._id, returnTo }}
            >
              删除
            </TableAction>
          </>
        )}
      </TableActions>
      <EditStudentDialog open={editOpen} onClose={() => setEditOpen(false)} student={student} returnTo={returnTo} />
    </>
  );
}

function EditStudentDialog({
  open,
  onClose,
  student,
  returnTo,
}: {
  open: boolean;
  onClose: () => void;
  student: RosterStudentRow;
  returnTo: string;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-full sm:w-[440px]" onClose={onClose}>
        <DialogHeader>
          <DialogTitle>编辑学生记录</DialogTitle>
        </DialogHeader>
        <form
          method="post"
          action="/admin/userbind/students"
          className="space-y-4 p-5"
          onSubmit={(event) => {
            const form = event.currentTarget;
            const yearInput = form.elements.namedItem('enrollmentYear');
            const year = yearInput instanceof HTMLInputElement ? yearInput.value.trim() : '';
            if (!year) {
              const existing = form.querySelector('input[name=clearEnrollmentYear]');
              if (!existing) {
                const hidden = document.createElement('input');
                hidden.type = 'hidden';
                hidden.name = 'clearEnrollmentYear';
                hidden.value = 'on';
                form.appendChild(hidden);
              }
            }
          }}
        >
          <input type="hidden" name="operation" value="updateStudent" />
          <input type="hidden" name="studentRecordId" value={student._id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <p className="text-sm text-muted-foreground">
            学号 <span className="font-mono text-foreground">{student.studentId}</span> 不可在此修改。
          </p>
          <FormField label="姓名" required htmlFor={`edit-realName-${student._id}`}>
            <Input id={`edit-realName-${student._id}`} name="realName" defaultValue={student.realName} required maxLength={32} />
          </FormField>
          <FormField label="入学年" htmlFor={`edit-year-${student._id}`} hint="留空表示清除入学年">
            <Input
              id={`edit-year-${student._id}`}
              name="enrollmentYear"
              defaultValue={student.enrollmentYear == null ? '' : String(student.enrollmentYear)}
              inputMode="numeric"
              placeholder="如 2024"
            />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button type="submit">保存</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RenameEntityDialog({
  open,
  onClose,
  title,
  action,
  hidden,
  currentName,
  fieldLabel,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  action: string;
  hidden: Record<string, string>;
  currentName: string;
  fieldLabel: string;
}) {
  const [name, setName] = useState(currentName);
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
        else setName(currentName);
      }}
    >
      <DialogContent className="w-full sm:w-[440px]" onClose={onClose}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form method="post" action={action} className="space-y-4 p-5">
          <input type="hidden" name="operation" value="rename" />
          {Object.entries(hidden).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
          <FormField label={fieldLabel} required htmlFor="rename-entity-name">
            <Input id="rename-entity-name" name="name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              保存
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
