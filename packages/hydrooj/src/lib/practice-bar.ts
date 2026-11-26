export interface PracticeBar {
    title: string;
    href: string;
    stageTitle: string;
    index: number;
    total: number;
    prevHref: string | null;
    nextHref: string | null;
    doneCount: number;
    totalCount: number;
}

/** Visible order is `stage.pids` filtered by `visiblePids`, keeping the stage order. */
export function buildPracticeBar(input: {
    title: string;
    tid: string;
    stage: { _id: number; title: string; pids: number[] };
    pid: number;
    visiblePids: ReadonlySet<number>;
    doneCount: number;
    totalCount: number;
    detailUrl: string;
    problemUrl: (pid: number) => string;
}): PracticeBar | null {
    if (!input.tid) throw new TypeError('practice bar tid missing');
    const visible = input.stage.pids.filter((pid) => input.visiblePids.has(pid));
    const position = visible.indexOf(input.pid);
    if (position < 0) return null;
    const previous = position > 0 ? visible[position - 1] : undefined;
    const next = position + 1 < visible.length ? visible[position + 1] : undefined;
    return {
        title: input.title,
        href: `${input.detailUrl}?chapter=${input.stage._id}`,
        stageTitle: input.stage.title,
        index: position + 1,
        total: visible.length,
        prevHref: previous === undefined ? null : input.problemUrl(previous),
        nextHref: next === undefined ? null : input.problemUrl(next),
        doneCount: input.doneCount,
        totalCount: input.totalCount,
    };
}
