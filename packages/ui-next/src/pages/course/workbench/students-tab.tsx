import { useState } from 'react';
import { MultiSelect } from '@/components/ui/multi-select';
import { Panel } from '@/components/ui/panel';
import { SwitchRow } from '../../teach/settings-kit';
import {
  courseGroupOptionLabel,
  mergeCourseGroupOptions,
  type ChapterDraft,
  type GroupRefView,
} from '../types';
import type { CourseEditorPageData } from './model';

export interface CourseTabProps {
  data: CourseEditorPageData;
  chapters: ChapterDraft[];
  onDirty: () => void;
  active: boolean;
}

function assertCourseGroupPayload(data: CourseEditorPageData): void {
  if (!Array.isArray(data.groupOptions) || !Array.isArray(data.attachedGroups) || typeof data.canManageOwnGroups !== 'boolean') {
    throw new TypeError('Invalid course group payload');
  }
}

function sameGroupIds(current: ReadonlySet<string>, next: readonly string[]): boolean {
  if (current.size !== next.length) return false;
  return next.every((id) => current.has(id));
}

/** Class groups and the student-hidden switch, posted on the course editor form. */
export function CourseStudentsTab({ data, onDirty, active }: CourseTabProps) {
  const course = data.tdoc ?? {};
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set((course.courseGroupIds || []).map(String)),
  );
  const [courseHidden, setCourseHidden] = useState(course.courseHidden === true);
  assertCourseGroupPayload(data);

  const attachedIds = new Set(data.attachedGroups.map((group) => group._id));
  const mergedGroups = mergeCourseGroupOptions(data.groupOptions, data.attachedGroups);
  const mergedIds = new Set(mergedGroups.map((group) => group._id));
  for (const groupId of selectedIds) {
    if (!mergedIds.has(groupId)) throw new TypeError(`Course group selection has no server view: ${groupId}`);
  }
  // Posted ids follow merge order, the same as the previous editor, not the stored list.
  const selectableGroups = mergedGroups.filter((group) => group.state !== 'deleted' || selectedIds.has(group._id));
  const selectedGroupViews = selectableGroups.filter((group) => selectedIds.has(group._id));

  return (
    <div hidden={!active} className="flex max-w-3xl flex-col gap-6">
      <Panel
        title="班级"
        description="指定后只有这些用户组里已绑定的学生能看到和进入这门课；不指定则全站可见。"
      >
        <MultiSelect<GroupRefView>
          options={selectableGroups}
          value={selectedGroupViews}
          onChange={(next) => {
            const nextIds = next.map((group) => group._id);
            if (sameGroupIds(selectedIds, nextIds)) return;
            setSelectedIds(new Set(nextIds));
            onDirty();
          }}
          getKey={(group) => group._id}
          getLabel={(group) => courseGroupOptionLabel(group, attachedIds.has(group._id))}
          renderChip={(group) => (
            <>
              <span className="sr-only">已选</span>
              <span>{courseGroupOptionLabel(group, attachedIds.has(group._id))}</span>
            </>
          )}
          name="courseGroupIds"
          placeholder="搜索班级"
          emptyText="没有匹配的班级"
        />
      </Panel>
      <Panel title="可见性">
        <input type="hidden" name="courseHidden" value={courseHidden ? 'true' : 'false'} />
        <SwitchRow
          id="course-students-hidden"
          label="对学生隐藏"
          description="隐藏后学生看不到这门课，也不能进入；你和协作者仍然可以编辑。"
          checked={courseHidden}
          onCheckedChange={(checked) => {
            setCourseHidden(checked);
            onDirty();
          }}
        />
      </Panel>
    </div>
  );
}
