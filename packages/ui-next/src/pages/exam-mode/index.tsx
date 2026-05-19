/**
 * /exam-mode index — card grid of exam contests eligible for the current user.
 *
 * Rendered inside the Qt Client's QWebEngineView (Phase 3 wiring) or, during
 * development, in a normal browser. The page is intentionally minimal — no
 * navigation chrome, just the exam cards.
 */
import { motion } from 'motion/react';
import { Calendar, ChevronRight, Clock, Lock, Swords } from 'lucide-react';
import { useBootstrap } from '@/lib/bootstrap';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface ExamCardData {
  _id: string;
  docId: string;
  title: string;
  beginAt: string;
  endAt: string;
  approvalMode?: 'strict' | 'auto';
  lockdownMode?: boolean;
  pids: number[];
  attended: boolean;
  inWindow: boolean;
}

function formatRange(begin: string, end: string): string {
  const b = new Date(begin);
  const e = new Date(end);
  const dur = Math.round((e.getTime() - b.getTime()) / 60000);
  return `${b.toLocaleString()} · ${dur} 分钟`;
}

export function ExamModeHomePage() {
  const data = useBootstrap().page.data as {
    exams: ExamCardData[];
    user: { name: string; studentId?: string; realName?: string };
  };
  const exams = data.exams || [];
  const live = exams.filter((e) => e.inWindow);
  const upcoming = exams.filter((e) => !e.inWindow && new Date(e.beginAt) > new Date());
  const past = exams.filter((e) => !e.inWindow && new Date(e.endAt) < new Date());

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <motion.header
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="flex items-center justify-between rounded-xl border bg-card p-5 shadow-sm"
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Swords className="size-5 text-primary" />
            <h1 className="text-xl font-semibold">考试入口</h1>
          </div>
          <p className="text-sm text-muted-foreground">选择一场考试进入答题</p>
        </div>
        {data.user.realName && (
          <div className="text-right text-sm">
            <p className="font-semibold">{data.user.realName}</p>
            <p className="text-xs text-muted-foreground">{data.user.studentId}</p>
          </div>
        )}
      </motion.header>

      <ExamSection title="进行中" exams={live} emptyHint="当前没有正在进行的考试" highlight />
      <ExamSection title="即将开始" exams={upcoming} emptyHint="暂无即将开始的考试" />
      {past.length > 0 && (
        <ExamSection title="历史考试" exams={past} emptyHint="" muted />
      )}
    </div>
  );
}

function ExamSection({
  title, exams, emptyHint, highlight, muted,
}: { title: string; exams: ExamCardData[]; emptyHint: string; highlight?: boolean; muted?: boolean }) {
  return (
    <section className="space-y-3">
      <h2 className={highlight ? 'text-base font-semibold text-primary' : 'text-base font-semibold text-muted-foreground'}>
        {title} <span className="text-xs font-normal text-muted-foreground">({exams.length})</span>
      </h2>
      {exams.length === 0 ? (
        emptyHint ? <p className="text-sm text-muted-foreground">{emptyHint}</p> : null
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {exams.map((e) => (
            <ExamCard key={e._id} exam={e} disabled={muted || !e.inWindow} />
          ))}
        </div>
      )}
    </section>
  );
}

function ExamCard({ exam, disabled }: { exam: ExamCardData; disabled?: boolean }) {
  return (
    <Card className={disabled ? 'opacity-70' : 'transition-shadow hover:shadow-md'}>
      <CardContent className="space-y-3 p-4">
        <div className="space-y-1">
          <h3 className="line-clamp-2 font-semibold">{exam.title}</h3>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className="gap-1 text-[10px]">
              <Calendar className="size-3" />{exam.pids.length} 题
            </Badge>
            {exam.lockdownMode && (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <Lock className="size-3" />屏幕锁定
              </Badge>
            )}
            {exam.approvalMode === 'strict' && (
              <Badge variant="outline" className="text-[10px]">人工审核</Badge>
            )}
          </div>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="size-3" />{formatRange(exam.beginAt, exam.endAt)}
        </p>
        <Button asChild disabled={disabled} className="w-full" variant={exam.inWindow ? 'default' : 'outline'}>
          <a href={`/exam-mode/${exam.docId}`}>
            {exam.inWindow ? '进入考试' : exam.attended ? '查看答卷' : '查看详情'}
            <ChevronRight className="size-4" />
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}
