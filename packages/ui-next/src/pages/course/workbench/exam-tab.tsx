import { Panel } from '@/components/ui/panel';
import { CourseExamSettings } from '../course-exam-settings';
import { readCourseExam, readCourseExamContest, type ChapterDraft } from '../types';
import type { CourseEditorPageData } from './model';

export interface CourseTabProps {
  data: CourseEditorPageData;
  chapters: ChapterDraft[];
  onDirty: () => void;
  active: boolean;
}

/** Exam tab reuses the existing settings control and only replaces the outer panel. */
export function CourseExamTab({ data, chapters, onDirty, active }: CourseTabProps) {
  const courseExam = readCourseExam(data.tdoc?.courseExam);
  const courseExamContest = readCourseExamContest(data.courseExamContest);

  return (
    <div hidden={!active}>
      <Panel
        title="结业考试"
        description="绑定一场整卷作答的考试作为结业考试，并设置学生看完多少视频后才能进入。"
      >
        <div className="flex flex-col gap-5">
          <CourseExamSettings
            chapters={chapters}
            initialExam={courseExam}
            initialContest={courseExamContest}
            onDirty={onDirty}
          />
        </div>
      </Panel>
    </div>
  );
}
