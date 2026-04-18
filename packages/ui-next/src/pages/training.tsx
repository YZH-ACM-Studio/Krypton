import { motion } from 'motion/react';
import { Users, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Pagination } from '@/components/ui/pagination';
import { useBootstrap } from '@/lib/bootstrap';
import { replaceRouteTokens } from '@/lib/format';

type R = Record<string, any>;

export function TrainingPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdocs: R[] = data.tdocs || [];
  const page = Number(data.page) || 1;
  const tpcount = Number(data.tpcount) || 1;
  const tsdict: Record<string, R> = data.tsdict || {};

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">训练</h1>
          <p className="text-sm text-muted-foreground">系统化训练计划</p>
        </div>
        <Button asChild>
          <a href={`${bs.urls.training}/create`}>创建训练</a>
        </Button>
      </div>

      {tdocs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            暂无训练计划
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tdocs.map((t) => {
            const ts = tsdict[String(t.docId)] || {};
            const enrolled = ts.enroll;
            const total = Array.isArray(t.dag)
              ? t.dag.reduce((n: number, s: R) => n + (Array.isArray(s.pids) ? s.pids.length : 0), 0)
              : 0;
            const done = Array.isArray(ts.donePids) ? ts.donePids.length : 0;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;

            return (
              <a
                key={String(t.docId)}
                href={replaceRouteTokens(bs.urls.trainingDetail, { TID: String(t.docId) })}
                className="group"
              >
                <Card className="h-full transition-colors group-hover:border-primary/30">
                  <CardHeader className="pb-2">
                    <CardTitle className="line-clamp-2 text-base">{t.title || '未命名训练'}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {t.content || t.desc || '精选题目训练'}
                    </p>
                    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Users className="size-3" />{t.attend || 0} 人参与</span>
                      {enrolled ? (
                        <span className="font-medium text-primary">{pct}%</span>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">未参加</Badge>
                      )}
                    </div>
                    {enrolled && total > 0 ? (
                      <div className="mt-2 h-1.5 rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </a>
            );
          })}
        </div>
      )}

      <Pagination current={page} total={tpcount} baseUrl={bs.urls.training} />
    </motion.div>
  );
}

export function TrainingDetailPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdoc: R = data.tdoc || {};
  const pids: (string | number)[] = data.pids || [];
  const pdict: Record<string, R> = data.pdict || {};
  const psdict: Record<string, R> = data.psdict || {};
  const tsdoc: R = data.tsdoc || {};

  const sections: R[] = Array.isArray(tdoc.dag) ? tdoc.dag : [];

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <a href={bs.urls.training} className="hover:text-primary">训练</a>
          <ChevronRight className="size-3" />
        </div>
        <h1 className="mt-1 text-2xl font-bold">{tdoc.title || '训练'}</h1>
        {tdoc.content ? (
          <p className="mt-2 text-sm text-muted-foreground">{tdoc.content}</p>
        ) : null}
        <div className="mt-3 flex gap-2">
          {!tsdoc.enroll ? (
            <form method="post">
              <input type="hidden" name="operation" value="enroll" />
              <Button type="submit" size="sm">参加训练</Button>
            </form>
          ) : (
            <Badge variant="secondary">已参加</Badge>
          )}
        </div>
      </div>

      {sections.map((section, si) => (
        <Card key={si}>
          <CardHeader>
            <CardTitle className="text-base">{section.title || `阶段 ${si + 1}`}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(section.pids || []).map((pid: string | number) => {
                const p = pdict[String(pid)] || {};
                const ps = psdict[String(pid)];
                return (
                  <a
                    key={String(pid)}
                    href={replaceRouteTokens(bs.urls.problemDetail, { PID: String(pid) })}
                    className="flex items-center justify-between rounded-md px-3 py-2 transition-colors hover:bg-accent"
                  >
                    <div>
                      <span className="font-mono text-xs text-muted-foreground">{pid}</span>
                      <span className="ml-2 text-sm font-medium">{p.title || '未命名'}</span>
                    </div>
                    {ps?.status === 1 ? (
                      <Badge variant="default" className="text-[10px]">AC</Badge>
                    ) : ps?.status ? (
                      <Badge variant="secondary" className="text-[10px]">尝试中</Badge>
                    ) : null}
                  </a>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}
    </motion.div>
  );
}
