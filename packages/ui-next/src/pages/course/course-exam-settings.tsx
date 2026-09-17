import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { SimpleSelect } from '@/components/ui/select';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import {
  readCourseExamDocumentId,
  type CourseExamBinding,
  type CourseExamContestPreview,
  type CourseExamGate,
} from './types';

interface ExamOption {
  id: string;
  title: string;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label}响应格式不正确`);
  return value as Record<string, unknown>;
}

function asTitle(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

async function readJson(path: string, fallback: string): Promise<Record<string, unknown>> {
  const response = await fetchHydroResponse(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } }, fallback);
  if (!response.ok) throw new Error(await readHydroResponseError(response, fallback));
  return asRecord(await response.json(), fallback);
}

function parseExamList(payload: Record<string, unknown>): ExamOption[] {
  if (!Array.isArray(payload.tdocs)) throw new TypeError('列表响应缺少 tdocs');
  return payload.tdocs.map((item) => {
    const rec = asRecord(item, '考试');
    const id = readCourseExamDocumentId(rec.docId ?? rec._id);
    return { id, title: asTitle(rec.title, id) };
  });
}

async function searchExams(query: string): Promise<ExamOption[]> {
  return parseExamList(await readJson(`/contest?rule=exam&q=${encodeURIComponent(query)}`, '搜索考试失败'));
}

function initialExamOptions(exam: CourseExamBinding | null, contest: CourseExamContestPreview | null): ExamOption[] {
  const contestId = exam?.contestId;
  if (!contestId) return [];
  const title = contest?.title || contestId;
  return [{ id: contestId, title }];
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(100, Math.max(1, Math.round(value)));
}

export function CourseExamSettings({
  chapters,
  initialExam,
  initialContest,
  onDirty,
}: {
  chapters: Array<{ _id: number; title: string }>;
  initialExam: CourseExamBinding | null;
  initialContest: CourseExamContestPreview | null;
  onDirty: () => void;
}) {
  const [selected, setSelected] = useState<ExamOption[]>(() => initialExamOptions(initialExam, initialContest));
  const [gate, setGate] = useState<CourseExamGate>(initialExam?.gate || 'all');
  const [percent, setPercent] = useState(initialExam?.percent ?? 100);
  const [chapterId, setChapterId] = useState(() => {
    if (typeof initialExam?.chapterId === 'number') return initialExam.chapterId;
    return chapters[0]?._id ?? 0;
  });

  const examId = selected[0]?.id || '';
  const chapterOptions = chapters.map((chapter) => ({
    value: String(chapter._id),
    label: chapter.title || `章节 ${chapter._id}`,
  }));
  if (gate === 'chapter' && chapterId && !chapters.some((chapter) => chapter._id === chapterId)) {
    chapterOptions.unshift({ value: String(chapterId), label: `章节 ${chapterId}（当前课程中不存在）` });
  }

  const setExamSelection = (next: ExamOption[]) => {
    setSelected(next.slice(0, 1));
    onDirty();
  };

  const setWatchGate = (next: CourseExamGate) => {
    setGate(next);
    if (next === 'chapter' && !chapters.some((chapter) => chapter._id === chapterId)) {
      const fallback = chapters[0]?._id;
      if (typeof fallback === 'number') setChapterId(fallback);
    }
    onDirty();
  };

  return (
    <>
      <div className="space-y-1.5">
        <span className="text-sm font-medium">考试</span>
        <MultiSelect<ExamOption>
          value={selected}
          onChange={setExamSelection}
          loadOptions={searchExams}
          getKey={(item) => item.id}
          getLabel={(item) => item.title}
          getDescription={() => '选择题考试'}
          placeholder="搜索考试标题"
          emptyText="没有匹配的选择题考试"
          maxItems={1}
          minHeight={44}
        />
        <p className="text-xs text-muted-foreground">最多绑定一场本域选择题考试。不选则取消结业考试。</p>
        <p className="text-xs text-muted-foreground">绑定会被拒绝：client_required 考试、比赛分配名单、空试卷、没有已确认视频，或考试范围未覆盖课程班级。</p>
      </div>

      <input type="hidden" name="courseExamContestId" value={examId} />
      {examId ? <input type="hidden" name="courseExamGate" value={gate} /> : null}
      {examId && gate === 'percent' ? <input type="hidden" name="courseExamPercent" value={String(percent)} /> : null}
      {examId && gate === 'chapter' ? <input type="hidden" name="courseExamChapterId" value={String(chapterId)} /> : null}

      {examId ? (
        <>
          <div className="space-y-1.5">
            <span className="text-sm font-medium">观看门槛</span>
            <RadioGroup aria-label="观看门槛">
              <RadioGroupItem
                value="all"
                checked={gate === 'all'}
                onChange={() => setWatchGate('all')}
                label="全部章"
                description="本课全部已确认视频都看完"
              />
              <RadioGroupItem
                value="chapter"
                checked={gate === 'chapter'}
                onChange={() => setWatchGate('chapter')}
                label="指定章"
                description="该章及其小节的视频都看完"
              />
              <RadioGroupItem
                value="percent"
                checked={gate === 'percent'}
                onChange={() => setWatchGate('percent')}
                label="整课百分比"
                description="整课已确认视频达到设定比例"
              />
            </RadioGroup>
          </div>

          {gate === 'chapter' ? (
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">指定章节</span>
              <SimpleSelect
                value={String(chapterId)}
                onValueChange={(value) => {
                  setChapterId(Number(value));
                  onDirty();
                }}
                options={chapterOptions}
                ariaLabel="选择结业考试章节"
                className="min-h-11"
                contentClassName="[&_[role=option]]:min-h-10"
              />
            </label>
          ) : null}

          {gate === 'percent' ? (
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">完成百分比</span>
              <Input
                type="number"
                min={1}
                max={100}
                step={1}
                value={percent}
                onChange={(event) => {
                  setPercent(clampPercent(Number(event.target.value)));
                  onDirty();
                }}
                className="min-h-11 text-base sm:text-sm"
              />
              <span className="block text-xs text-muted-foreground">1–100 的整数，默认 100。按条数比例向下取整。</span>
            </label>
          ) : null}
        </>
      ) : null}
    </>
  );
}
