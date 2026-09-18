import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ClipboardPaste, Copy, Redo2, Search, Trash2, Undo2 } from 'lucide-react';
import { effectiveProblemKind, PROBLEM_KINDS, problemKindToSlug, type ProblemKind } from '@hydrooj/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { replaceRouteTokens } from '@/lib/format';
import {
  fetchProblemsByIds,
  listPidNamespaceOptions,
  problemKey,
  searchProblemBankAll,
  searchProblemBankPage,
  searchProblems,
  type PidNamespaceOption,
  type ProblemOption,
} from '@/lib/multi-select-presets';
import { ContestExamPaperQuotas } from './contest-exam-paper-quotas';

const KIND_LABEL: Record<ProblemKind, string> = {
  programming: '编程',
  single: '单选',
  multi: '多选',
  true_false: '判断',
  blank: '填空',
  subjective: '主观',
  program_fill: '程序填空',
  function: '函数',
};

const HISTORY_LIMIT = 50;

export function examPaperBankCanAddAll(query: string, kind: string): boolean {
  return Boolean(query.trim() || kind);
}

export type ExamPaperPdictRow = {
  problemKind?: unknown;
  title?: unknown;
  pid?: unknown;
  docId?: unknown;
};

export type ExamPaperHistory = {
  entries: string[][];
  index: number;
};

export type ExamPaperPoolRow = {
  key: string;
  docId: number;
  pid?: string | number;
  title: string;
  kind: ProblemKind;
};

export function parseExamPaperPidTokens(raw: string): string[] {
  return uniqueExamPaperPids(raw.split(/[\s,;，；]+/));
}

export function uniqueExamPaperPids(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const key = id.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function examPaperHistoryInit(present: string[]): ExamPaperHistory {
  return { entries: [uniqueExamPaperPids(present)], index: 0 };
}

export function examPaperHistoryPush(history: ExamPaperHistory, next: string[]): ExamPaperHistory {
  const present = uniqueExamPaperPids(next);
  if (history.entries[history.index].join(',') === present.join(',')) return history;
  const entries = [...history.entries.slice(0, history.index + 1), present].slice(-HISTORY_LIMIT);
  return { entries, index: entries.length - 1 };
}

export function examPaperHistoryUndo(history: ExamPaperHistory): ExamPaperHistory | null {
  if (history.index <= 0) return null;
  return { ...history, index: history.index - 1 };
}

export function examPaperHistoryRedo(history: ExamPaperHistory): ExamPaperHistory | null {
  if (history.index >= history.entries.length - 1) return null;
  return { ...history, index: history.index + 1 };
}

export function examPaperHistoryCurrent(history: ExamPaperHistory): string[] {
  return history.entries[history.index];
}

export function moveExamPaperPoolBlock(all: readonly string[], selected: readonly string[], delta: -1 | 1): string[] {
  const selectedSet = new Set(selected);
  const block = all.filter((id) => selectedSet.has(id));
  if (!block.length) return [...all];
  const start = all.findIndex((id) => selectedSet.has(id));
  const nextStart = Math.max(0, Math.min(all.length - block.length, start + delta));
  const rest = all.filter((id) => !selectedSet.has(id));
  return [...rest.slice(0, nextStart), ...block, ...rest.slice(nextStart)];
}

export function filterExamPaperPoolRows(rows: readonly ExamPaperPoolRow[], kind: ProblemKind | '', text: string): ExamPaperPoolRow[] {
  const needle = text.trim().toLowerCase();
  return rows.filter((row) => {
    if (kind && row.kind !== kind) return false;
    if (!needle) return true;
    return [row.key, String(row.pid || ''), row.title].some((part) => part.toLowerCase().includes(needle));
  });
}

export function examPaperPoolRowFromOption(option: ProblemOption, fallback?: ExamPaperPdictRow): ExamPaperPoolRow {
  const key = problemKey(option);
  return {
    key,
    docId: option.docId || Number(key) || 0,
    pid: option.pid ?? (typeof fallback?.pid === 'string' || typeof fallback?.pid === 'number' ? fallback.pid : undefined),
    title: option.title || (typeof fallback?.title === 'string' ? fallback.title : ''),
    kind: effectiveProblemKind({ problemKind: option.problemKind ?? fallback?.problemKind }),
  };
}

function rowFromId(id: string, pdict?: Record<string, ExamPaperPdictRow>): ExamPaperPoolRow {
  const meta = pdict?.[id];
  const docId = Number(meta?.docId ?? id);
  return {
    key: id,
    docId: Number.isInteger(docId) && docId > 0 ? docId : 0,
    pid: typeof meta?.pid === 'string' || typeof meta?.pid === 'number' ? meta.pid : undefined,
    title: typeof meta?.title === 'string' ? meta.title : '',
    kind: effectiveProblemKind({ problemKind: meta?.problemKind }),
  };
}

export function ContestExamPaperPool({
  name = 'pids',
  value,
  onChange,
  pdict,
  quotas,
}: {
  name?: string;
  value: string[];
  onChange: (next: string[]) => void;
  pdict?: Record<string, ExamPaperPdictRow>;
  quotas?: Partial<Record<string, number>>;
}) {
  const bs = useBootstrap();
  const [history, setHistory] = useState(() => examPaperHistoryInit(value));
  const [catalog, setCatalog] = useState<Record<string, ExamPaperPoolRow>>(() =>
    Object.fromEntries(value.map((id) => [id, rowFromId(id, pdict)])),
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [poolKind, setPoolKind] = useState<ProblemKind | ''>('');
  const [poolQuery, setPoolQuery] = useState('');
  const [bankQuery, setBankQuery] = useState('');
  const [bankKind, setBankKind] = useState('');
  const [bankHits, setBankHits] = useState<ExamPaperPoolRow[]>([]);
  const [bankSelected, setBankSelected] = useState<string[]>([]);
  const [bankPage, setBankPage] = useState(1);
  const [bankPageCount, setBankPageCount] = useState(0);
  const [bankTotal, setBankTotal] = useState(0);
  const [bankBusy, setBankBusy] = useState(false);
  const [namespaces, setNamespaces] = useState<PidNamespaceOption[]>([]);
  const [namespaceId, setNamespaceId] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [status, setStatus] = useState('');

  const pids = uniqueExamPaperPids(value);
  const rows = useMemo(() => pids.map((id) => catalog[id] || rowFromId(id, pdict)), [catalog, pdict, pids]);
  const visible = useMemo(() => filterExamPaperPoolRows(rows, poolKind, poolQuery), [poolKind, poolQuery, rows]);
  const visibleKeys = visible.map((row) => row.key);
  const selectedSet = new Set(selected);
  const visibleSelected = visibleKeys.filter((key) => selectedSet.has(key));
  const allVisibleSelected = visibleKeys.length > 0 && visibleSelected.length === visibleKeys.length;
  const someVisibleSelected = visibleSelected.length > 0 && !allVisibleSelected;
  const poolCounts = useMemo(() => {
    const counts = Object.fromEntries(PROBLEM_KINDS.map((kind) => [kind, 0])) as Record<ProblemKind, number>;
    for (const row of rows) counts[row.kind] += 1;
    return counts;
  }, [rows]);
  const quotaPids = pids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
  const canUndo = history.index > 0;
  const canRedo = history.index < history.entries.length - 1;

  useEffect(() => {
    let cancelled = false;
    listPidNamespaceOptions()
      .then((rows) => {
        if (!cancelled) setNamespaces(rows);
      })
      .catch((error) => {
        if (!cancelled) setStatus(error instanceof Error ? error.message : '无法读取题号命名空间');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!pids.length) return undefined;
    let cancelled = false;
    const missing = pids.filter((id) => !(catalog[id]?.title || pdict?.[id]?.title));
    if (!missing.length) return undefined;
    fetchProblemsByIds(missing).then((found) => {
      if (cancelled) return;
      setCatalog((current) => {
        const next = { ...current };
        for (const option of found) {
          const row = examPaperPoolRowFromOption(option, pdict?.[problemKey(option)]);
          next[row.key] = row;
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [pids.join(',')]);

  const remember = (row: ExamPaperPoolRow) => {
    setCatalog((current) => ({ ...current, [row.key]: row }));
  };

  const commit = (next: string[], message: string) => {
    const unique = uniqueExamPaperPids(next);
    setHistory((current) => examPaperHistoryPush(current, unique));
    onChange(unique);
    setSelected((current) => current.filter((id) => unique.includes(id)));
    setStatus(message);
  };

  const undo = () => {
    const next = examPaperHistoryUndo(history);
    if (!next) return;
    setHistory(next);
    onChange(examPaperHistoryCurrent(next));
    setStatus('已撤销');
  };

  const redo = () => {
    const next = examPaperHistoryRedo(history);
    if (!next) return;
    setHistory(next);
    onChange(examPaperHistoryCurrent(next));
    setStatus('已重做');
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const rememberMany = (rows: ExamPaperPoolRow[]) => {
    setCatalog((current) => {
      const next = { ...current };
      for (const row of rows) next[row.key] = row;
      return next;
    });
  };

  const loadBankPage = async (page: number) => {
    setBankBusy(true);
    setStatus('');
    try {
      const result = await searchProblemBankPage({
        query: bankQuery.trim() || undefined,
        kind: bankKind || undefined,
        page,
        quick: false,
      });
      const hits = result.problems.map((option) => examPaperPoolRowFromOption(option));
      rememberMany(hits);
      setBankHits(hits);
      setBankSelected([]);
      setBankPage(result.page);
      setBankPageCount(result.ppcount);
      setBankTotal(result.pcount);
      if (result.pidNamespaces.length && !namespaces.length) setNamespaces(result.pidNamespaces);
      setStatus(result.pcount ? `找到 ${result.pcount} 道题，本页 ${hits.length} 道` : '没有匹配的题目');
    } catch (error) {
      setBankHits([]);
      setBankSelected([]);
      setBankPageCount(0);
      setBankTotal(0);
      setStatus(error instanceof Error ? error.message : '题库搜索失败');
    } finally {
      setBankBusy(false);
    }
  };

  const searchBank = () => loadBankPage(1);

  const addKeys = (keys: string[]) => {
    const incoming = uniqueExamPaperPids(keys);
    const added = incoming.filter((id) => !pids.includes(id));
    if (!added.length) {
      setStatus('所选题目都已在题池中');
      return 0;
    }
    commit([...pids, ...added], `已加入 ${added.length} 道题${incoming.length > added.length ? `，跳过 ${incoming.length - added.length} 道重复` : ''}`);
    return added.length;
  };

  const addFromBank = () => {
    const keys = bankSelected.length ? bankSelected : bankHits.map((row) => row.key);
    addKeys(keys);
    setBankSelected([]);
  };

  const addAllMatching = async () => {
    if (!examPaperBankCanAddAll(bankQuery, bankKind)) {
      setStatus('请先输入搜索或选择题型，再加入全部匹配。整库一次加入请用题号命名空间。');
      return;
    }
    setBankBusy(true);
    setStatus('');
    try {
      const found = await searchProblemBankAll(
        {
          query: bankQuery.trim() || undefined,
          kind: bankKind || undefined,
          quick: false,
        },
        (page, pageCount) => setStatus(`正在读取第 ${page}/${pageCount} 页…`),
      );
      const rows = found.map((option) => examPaperPoolRowFromOption(option));
      rememberMany(rows);
      addKeys(rows.map((row) => row.key));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '加入全部匹配失败');
    } finally {
      setBankBusy(false);
    }
  };

  const addNamespace = async () => {
    if (!namespaceId) {
      setStatus('请先选择题号命名空间');
      return;
    }
    setBankBusy(true);
    setStatus('');
    try {
      const found = await searchProblemBankAll(
        {
          pidNamespaceId: namespaceId,
          kind: bankKind || undefined,
          quick: false,
        },
        (page, pageCount) => setStatus(`正在读取命名空间第 ${page}/${pageCount} 页…`),
      );
      if (!found.length) {
        setStatus('该命名空间没有可见题目');
        return;
      }
      const rows = found.map((option) => examPaperPoolRowFromOption(option));
      rememberMany(rows);
      addKeys(rows.map((row) => row.key));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '加入命名空间失败');
    } finally {
      setBankBusy(false);
    }
  };

  const addFromPaste = async () => {
    const tokens = parseExamPaperPidTokens(pasteText);
    if (!tokens.length) {
      setStatus('没有可解析的题号');
      return;
    }
    setBankBusy(true);
    try {
      const found = await Promise.all(
        tokens.map(async (token) => {
          const list = await searchProblems(token, 5, { quick: false });
          const match = list.find((option) => problemKey(option) === token || String(option.pid) === token || String(option.docId) === token);
          return match ? examPaperPoolRowFromOption(match) : rowFromId(token, pdict);
        }),
      );
      for (const row of found) remember(row);
      addKeys(found.map((row) => row.key));
      setPasteOpen(false);
      setPasteText('');
    } finally {
      setBankBusy(false);
    }
  };

  const toggleSelected = (key: string, checked: boolean) => {
    setSelected((current) => (checked ? uniqueExamPaperPids([...current, key]) : current.filter((id) => id !== key)));
  };

  const toggleBankSelected = (key: string, checked: boolean) => {
    setBankSelected((current) => (checked ? uniqueExamPaperPids([...current, key]) : current.filter((id) => id !== key)));
  };

  const copyVisible = async () => {
    const text = visible.map((row) => String(row.pid || row.key)).join('\n');
    if (!text) {
      setStatus('当前筛选没有题目可复制');
      return;
    }
    await navigator.clipboard.writeText(text);
    setStatus(`已复制 ${visible.length} 个题号`);
  };

  const problemHref = (row: ExamPaperPoolRow) => replaceRouteTokens(bs.urls.problemDetail, { PID: String(row.pid || row.docId || row.key) });

  return (
    <div className="space-y-5">
      <input type="hidden" name={name} value={pids.join(',')} />

      <section className="space-y-3 rounded-xl border bg-muted/20 p-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium">从题库加入</h3>
            <p className="text-xs text-muted-foreground">搜索按页预览，可以加入本页或全部匹配；也可以一次加入整个题号命名空间。</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setPasteOpen(true)}>
            <ClipboardPaste />
            粘贴题号
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem_auto]">
          <label className="space-y-1.5">
            <span className="text-xs text-muted-foreground">搜索</span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={bankQuery}
                onChange={(event) => setBankQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void searchBank();
                  }
                }}
                placeholder="题号、标题或标签"
                className="pl-9"
              />
            </span>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs text-muted-foreground">题型</span>
            <SimpleSelect
              value={bankKind}
              onValueChange={setBankKind}
              ariaLabel="搜索题型"
              options={[{ value: '', label: '全部题型' }, ...PROBLEM_KINDS.map((kind) => ({ value: problemKindToSlug(kind), label: KIND_LABEL[kind] }))]}
            />
          </label>
          <Button type="button" className="md:mt-6" disabled={bankBusy} onClick={() => void searchBank()}>
            {bankBusy ? '搜索中…' : '搜索'}
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <label className="space-y-1.5">
            <span className="text-xs text-muted-foreground">题号命名空间</span>
            <SimpleSelect
              value={namespaceId}
              onValueChange={setNamespaceId}
              ariaLabel="题号命名空间"
              options={[
                { value: '', label: namespaces.length ? '选择题号命名空间' : '正在读取命名空间…' },
                ...namespaces.map((namespace) => ({
                  value: namespace.namespaceId,
                  label: namespace.enabled ? namespace.name : `${namespace.name}（已停用）`,
                })),
              ]}
            />
          </label>
          <Button type="button" variant="outline" className="md:mt-6" disabled={bankBusy || !namespaceId} onClick={() => void addNamespace()}>
            加入该命名空间全部题目
          </Button>
        </div>
        {bankHits.length || bankTotal ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {bankTotal
                  ? `共 ${bankTotal} 道 · 第 ${bankPage}/${Math.max(bankPageCount, 1)} 页 · 本页 ${bankHits.length} 道`
                  : `本页 ${bankHits.length} 道`}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={bankBusy || bankPage <= 1}
                  onClick={() => void loadBankPage(bankPage - 1)}
                >
                  上一页
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={bankBusy || bankPageCount <= 0 || bankPage >= bankPageCount}
                  onClick={() => void loadBankPage(bankPage + 1)}
                >
                  下一页
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setBankSelected(bankHits.map((row) => row.key))}
                >
                  全选本页
                </Button>
                <Button type="button" size="sm" disabled={!bankHits.length} onClick={addFromBank}>
                  加入所选{bankSelected.length ? `（${bankSelected.length}）` : '本页'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={bankBusy || !examPaperBankCanAddAll(bankQuery, bankKind)}
                  onClick={() => void addAllMatching()}
                >
                  加入全部匹配{bankTotal ? `（${bankTotal}）` : ''}
                </Button>
              </div>
            </div>
            {bankHits.length ? (
              <PoolTable
                rows={bankHits}
                selected={bankSelected}
                onToggle={toggleBankSelected}
                onToggleAll={(checked) => setBankSelected(checked ? bankHits.map((row) => row.key) : [])}
                hrefFor={problemHref}
                alreadyIn={new Set(pids)}
              />
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">题池</h3>
            <p className="text-xs text-muted-foreground">
              {pids.length} 道题{visible.length !== pids.length ? ` · 当前显示 ${visible.length}` : ''}
              {visibleSelected.length ? ` · 已选 ${visibleSelected.length}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={!canUndo} onClick={undo}>
              <Undo2 />
              撤销
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={!canRedo} onClick={redo}>
              <Redo2 />
              重做
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={!visible.length} onClick={() => void copyVisible()}>
              <Copy />
              复制题号
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <KindChip label="全部" count={pids.length} active={poolKind === ''} onClick={() => setPoolKind('')} />
          {PROBLEM_KINDS.map((kind) => (
            <KindChip
              key={kind}
              label={KIND_LABEL[kind]}
              count={poolCounts[kind]}
              active={poolKind === kind}
              onClick={() => setPoolKind(kind === poolKind ? '' : kind)}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={poolQuery}
            onChange={(event) => setPoolQuery(event.target.value)}
            placeholder="筛选题池中的题号或标题"
            className="max-w-sm"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!visible.length}
            onClick={() => setSelected(allVisibleSelected ? selected.filter((id) => !visibleKeys.includes(id)) : uniqueExamPaperPids([...selected, ...visibleKeys]))}
          >
            {allVisibleSelected ? '取消全选' : '全选当前筛选'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!visible.length}
            onClick={() => {
              const flipped = visibleKeys.filter((key) => !selectedSet.has(key));
              setSelected(uniqueExamPaperPids([...selected.filter((id) => !visibleKeys.includes(id)), ...flipped]));
            }}
          >
            反选
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!selected.length}
            onClick={() => commit(moveExamPaperPoolBlock(pids, selected, -1), '已上移所选')}
          >
            <ArrowUp />
            上移
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!selected.length}
            onClick={() => commit(moveExamPaperPoolBlock(pids, selected, 1), '已下移所选')}
          >
            <ArrowDown />
            下移
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={!selected.length}
            onClick={() => commit(
              pids.filter((id) => !selectedSet.has(id)),
              `已移除 ${selected.length} 道题`,
            )}
          >
            <Trash2 />
            移除所选
          </Button>
        </div>
        {pids.length ? (
          <PoolTable
            rows={visible}
            selected={selected}
            onToggle={toggleSelected}
            onToggleAll={(checked) => {
              setSelected(checked ? uniqueExamPaperPids([...selected, ...visibleKeys]) : selected.filter((id) => !visibleKeys.includes(id)));
            }}
            hrefFor={problemHref}
            showIndex
            allSelected={allVisibleSelected}
            indeterminate={someVisibleSelected}
          />
        ) : (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">题池还是空的。先搜索或粘贴题号。</p>
        )}
        {status ? <p className="text-xs text-muted-foreground">{status}</p> : null}
      </section>

      <ContestExamPaperQuotas pids={quotaPids} pdict={Object.fromEntries(rows.map((row) => [row.key, { problemKind: row.kind }]))} quotas={quotas} />

      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>粘贴题号</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-2">
            <p className="text-sm text-muted-foreground">支持空格、逗号或换行分隔的题号 / 内部 ID。</p>
            <Textarea value={pasteText} onChange={(event) => setPasteText(event.target.value)} rows={8} placeholder="P1001&#10;12, 13" />
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setPasteOpen(false)}>
              取消
            </Button>
            <Button type="button" disabled={bankBusy} onClick={() => void addFromPaste()}>
              加入题池
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KindChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label} ${count}`}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors',
        active ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-accent/60',
      )}
    >
      {label}
      <span className="tabular-nums">{count}</span>
    </button>
  );
}

function PoolTable({
  rows,
  selected,
  onToggle,
  onToggleAll,
  hrefFor,
  alreadyIn,
  showIndex = false,
  allSelected,
  indeterminate,
}: {
  rows: ExamPaperPoolRow[];
  selected: string[];
  onToggle: (key: string, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  hrefFor: (row: ExamPaperPoolRow) => string;
  alreadyIn?: Set<string>;
  showIndex?: boolean;
  allSelected?: boolean;
  indeterminate?: boolean;
}) {
  const selectedSet = new Set(selected);
  const headerChecked = allSelected ?? (rows.length > 0 && rows.every((row) => selectedSet.has(row.key)));
  const headerIndeterminate = indeterminate ?? (rows.some((row) => selectedSet.has(row.key)) && !headerChecked);
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table density="compact">
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                size="sm"
                checked={headerChecked}
                indeterminate={headerIndeterminate}
                onCheckedChange={(checked) => onToggleAll(!!checked)}
                aria-label="全选"
              />
            </TableHead>
            {showIndex ? <TableHead className="w-12">#</TableHead> : null}
            <TableHead className="w-28">题号</TableHead>
            <TableHead>标题</TableHead>
            <TableHead className="w-24">题型</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={row.key} data-state={selectedSet.has(row.key) ? 'selected' : undefined}>
              <TableCell>
                <Checkbox
                  size="sm"
                  checked={selectedSet.has(row.key)}
                  onCheckedChange={(checked) => onToggle(row.key, !!checked)}
                  aria-label={`选择 ${row.pid || row.key}`}
                />
              </TableCell>
              {showIndex ? <TableCell className="tabular-nums text-muted-foreground">{index + 1}</TableCell> : null}
              <TableCell className="font-mono text-xs">
                <a href={hrefFor(row)} className="hover:text-primary hover:underline" target="_blank" rel="noreferrer">
                  {row.pid || row.key}
                </a>
              </TableCell>
              <TableCell>
                <span className="line-clamp-1">{row.title || '未命名题目'}</span>
                {alreadyIn?.has(row.key) ? (
                  <Badge variant="outline" className="ml-2 text-[10px]">
                    已在题池
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{KIND_LABEL[row.kind]}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
