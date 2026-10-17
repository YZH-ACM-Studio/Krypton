import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DialogHost } from '../../src/components/ui/dialog.tsx';
import type { ChapterDraft, CourseAuthorVideo, SectionDraft } from '../../src/pages/course/types.ts';
import {
    addChapter,
    addSection,
    chapterCounts,
    moveChapter,
    moveSection,
    removeChapter,
    removeSection,
} from '../../src/pages/course/workbench/model.ts';

// PLAN §0. A static import fails collection while this module is absent, so the
// acceptance assertions below still run and fail on the missing behavior.
const panelLoaders = import.meta.glob('../../src/pages/course/workbench/outline-panel.tsx');

const OUTLINE_PANEL_FILE = 'packages/ui-next/src/pages/course/workbench/outline-panel.tsx';
const TITLES = ['绪论', '空小节', '线性表', '顺序表'] as const;
const BLOCKER = '这一章是结业考试的解锁条件，先在「结业考试」里改掉';
const DELETE_MESSAGE = '章节里的视频、讲义和题目会一起移出课程。';
const GENERATE = '从专属导图生成章节…';
const SELECT_CASE = '点第 2 章应 onSelect(2, null)，点其小节应 onSelect(2, sectionId)';
const ADD_CHAPTER_CASE = '「加一章」应让 onChange 收到多一章的数组';
const BLOCKED_DELETE_CASE = '有 removalBlocker 的章，菜单中「删除」应禁用';

interface OutlinePanelProps {
    chapters: ChapterDraft[];
    activeId: number;
    activeSectionId: number | null;
    onSelect: (chapterId: number, sectionId: number | null) => void;
    onChange: (next: ChapterDraft[]) => void;
    removalBlocker: (chapter: ChapterDraft) => string | null;
    onGenerateFromMindmap: () => void;
}

function readField(record: object, key: string): unknown {
    if (!(key in record)) return undefined;
    return Reflect.get(record, key) as unknown;
}

async function loadOutline(): Promise<ComponentType<OutlinePanelProps> | null> {
    let load: unknown;
    for (const [key, candidate] of Object.entries(panelLoaders)) {
        if (key.endsWith(OUTLINE_PANEL_FILE) || key.endsWith('src/pages/course/workbench/outline-panel.tsx')) load = candidate;
    }
    if (typeof load !== 'function') return null;
    const imported: unknown = await load();
    if (typeof imported !== 'object' || imported === null) return null;
    const value = readField(imported, 'OutlinePanel');
    if (typeof value !== 'function') return null;
    return value as ComponentType<OutlinePanelProps>;
}

function authorVideo(id: string): CourseAuthorVideo {
    return {
        id,
        title: id,
        filename: `${id}.mp4`,
        ext: 'mp4',
        size: 1,
        durationMs: 1000,
        confirmed: true,
        contentRevision: 1,
    };
}

function sectionDraft(
    id: number,
    title: string,
    extras: Partial<Pick<SectionDraft, 'pids' | 'videos'>> = {},
): SectionDraft {
    return {
        _id: id,
        title,
        content: '',
        pids: extras.pids ?? [],
        videos: extras.videos ?? [],
    };
}

function chapterDraft(
    overrides: { _id: number; title: string } & Partial<Omit<ChapterDraft, '_id' | 'title'>>,
): ChapterDraft {
    return {
        content: '',
        pids: [],
        videos: [],
        sections: [],
        tids: '',
        problemSetId: '',
        stageIds: '',
        ...overrides,
    };
}

function sampleChapters(): ChapterDraft[] {
    return [
        chapterDraft({
            _id: 1,
            title: '绪论',
            sections: [sectionDraft(11, '空小节')],
        }),
        chapterDraft({
            _id: 2,
            title: '线性表',
            pids: ['P1001'],
            videos: [authorVideo('ch-video')],
            sections: [sectionDraft(21, '顺序表', {
                pids: ['P2001', 'P2002'],
                videos: [authorVideo('sec-video')],
            })],
            tids: 'hw-1',
            problemSetId: 'ps-1',
        }),
    ];
}

function contentTotal(chapter: ChapterDraft, sectionId: number | null): number {
    // PLAN 只说右侧一个计数。chapterCounts 是契约里唯一的计数，原型也是单个数字，所以行上显示 videos + problems + refs。
    const counts = chapterCounts(chapter, sectionId);
    return counts.videos + counts.problems + counts.refs;
}

function textOf(title: string): HTMLElement | null {
    const node = screen.queryByText(title);
    if (!(node instanceof HTMLElement)) return null;
    return node;
}

function follows(anchor: Node, node: Node): boolean {
    return (anchor.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

function earliest(nodes: readonly HTMLElement[]): HTMLElement | undefined {
    return nodes.reduce<HTMLElement | undefined>((best, node) => {
        if (!best || follows(node, best)) return node;
        return best;
    }, undefined);
}

function latest(nodes: readonly HTMLElement[]): HTMLElement | undefined {
    return nodes.reduce<HTMLElement | undefined>((best, node) => {
        if (!best || follows(best, node)) return node;
        return best;
    }, undefined);
}

function containsForeign(node: HTMLElement, title: string, titles: readonly string[]): boolean {
    const text = node.textContent ?? '';
    return titles.some((item) => item !== title && text.includes(item));
}

function rowNodes(title: string, titles: readonly string[]): HTMLElement[] {
    const label = textOf(title);
    if (!label) return [];
    const ancestors: HTMLElement[] = [];
    let current: HTMLElement | null = label;
    while (current && current.getAttribute('data-slot') !== 'panel') {
        if (containsForeign(current, title, titles)) break;
        ancestors.push(current);
        current = current.parentElement;
    }
    const panel = label.closest('[data-slot="panel"]') ?? document.body;
    const others = titles.flatMap((item) => {
        if (item === title) return [];
        const node = textOf(item);
        return node ? [node] : [];
    });
    const next = earliest(others.filter((node) => follows(label, node)));
    const previous = latest(others.filter((node) => follows(node, label)));
    const band = [...panel.querySelectorAll('*')].filter((node): node is HTMLElement => {
        if (!(node instanceof HTMLElement)) return false;
        if (containsForeign(node, title, titles)) return false;
        if (previous && !follows(previous, node)) return false;
        if (next && !follows(node, next)) return false;
        return true;
    });
    const merged: HTMLElement[] = [];
    for (const node of [...ancestors, ...band]) {
        if (!merged.includes(node)) merged.push(node);
    }
    return merged;
}

function findMenuButton(title: string, titles: readonly string[]): HTMLButtonElement | null {
    const buttons = rowNodes(title, titles).filter((node): node is HTMLButtonElement => {
        return node instanceof HTMLButtonElement
            && (node.textContent ?? '').trim() === ''
            && node.querySelector('svg') !== null;
    });
    const marked = buttons.filter((button) => button.hasAttribute('aria-expanded'));
    const pool = marked.length > 0 ? marked : buttons;
    return pool[pool.length - 1] ?? null;
}

async function openMenu(user: UserEvent, title: string, titles: readonly string[]): Promise<HTMLElement | null> {
    const label = textOf(title);
    const trigger = findMenuButton(title, titles);
    if (!label || !trigger) return null;
    await user.hover(label);
    const host = label.closest('button');
    if (host instanceof HTMLElement) host.focus();
    await user.click(trigger);
    return screen.findByRole('menu');
}

function currentValue(title: string, titles: readonly string[]): string | null {
    for (const node of rowNodes(title, titles)) {
        const value = node.getAttribute('aria-current');
        if (value && value !== 'false') return value;
    }
    return null;
}

function hasClassToken(title: string, titles: readonly string[], token: string): boolean {
    return rowNodes(title, titles).some((node) => node.classList.contains(token));
}

function countText(title: string, titles: readonly string[]): string | null {
    const node = rowNodes(title, titles).find((item) => {
        const text = (item.textContent ?? '').trim();
        return item.classList.contains('text-xs')
            && item.classList.contains('tabular')
            && item.classList.contains('text-fg-subtle')
            && /^\d+$/.test(text);
    });
    return node ? (node.textContent ?? '').trim() : null;
}

function isDisabled(node: HTMLElement | null): boolean {
    if (!node) return false;
    return node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true';
}

function renderOutline(
    OutlinePanel: ComponentType<OutlinePanelProps>,
    options: {
        chapters: ChapterDraft[];
        activeId?: number;
        activeSectionId?: number | null;
        removalBlocker?: (chapter: ChapterDraft) => string | null;
        onSelect?: (chapterId: number, sectionId: number | null) => void;
        onChange?: (next: ChapterDraft[]) => void;
        onGenerateFromMindmap?: () => void;
    },
) {
    const onSelect = options.onSelect ?? vi.fn<(chapterId: number, sectionId: number | null) => void>();
    const onChange = options.onChange ?? vi.fn<(next: ChapterDraft[]) => void>();
    const onGenerateFromMindmap = options.onGenerateFromMindmap ?? vi.fn<() => void>();
    render(
        <>
            <OutlinePanel
                chapters={options.chapters}
                activeId={options.activeId ?? 1}
                activeSectionId={options.activeSectionId ?? null}
                onSelect={onSelect}
                onChange={onChange}
                removalBlocker={options.removalBlocker ?? (() => null)}
                onGenerateFromMindmap={onGenerateFromMindmap}
            />
            <DialogHost />
        </>,
    );
    return { onSelect, onChange, onGenerateFromMindmap };
}

function deleteTitle(title: string): string {
    return `删除「${title}」？`;
}

const KEYBOARD_TITLES = ['第一章', '甲节', '乙节', '丙节', '第二章', '丁节'] as const;

function keyboardChapters(): ChapterDraft[] {
    return [
        chapterDraft({
            _id: 1,
            title: '第一章',
            sections: [
                sectionDraft(11, '甲节'),
                sectionDraft(12, '乙节'),
                sectionDraft(13, '丙节'),
            ],
        }),
        chapterDraft({
            _id: 2,
            title: '第二章',
            sections: [sectionDraft(21, '丁节')],
        }),
    ];
}

function stackedRect(top: number): DOMRect {
    const left = 16;
    const width = 240;
    const height = 40;
    return {
        x: left,
        y: top,
        top,
        left,
        width,
        height,
        bottom: top + height,
        right: left + width,
        toJSON() {
            return {};
        },
    } as DOMRect;
}

function installStackedRects(): () => void {
    const original = Element.prototype.getBoundingClientRect;
    const height = 40;
    Element.prototype.getBoundingClientRect = function () {
        const nodes = document.body ? [...document.body.querySelectorAll('*')] : [];
        const index = nodes.indexOf(this);
        const top = index < 0 ? height : (index + 1) * height;
        return stackedRect(top);
    };
    return () => {
        Element.prototype.getBoundingClientRect = original;
    };
}

function sortableHandle(title: string, titles: readonly string[]): HTMLElement | null {
    return rowNodes(title, titles).find((node) => node.getAttribute('aria-roledescription') === 'sortable') ?? null;
}

async function keyboardNudge(user: UserEvent, handle: HTMLElement, key: 'ArrowDown' | 'ArrowUp' = 'ArrowDown'): Promise<void> {
    handle.focus();
    // `{Space}` is not a key name in user-event; `[Space]` is the physical key dnd-kit listens for.
    await user.keyboard('[Space]');
    await act(async () => {
        await new Promise<void>((done) => {
            setTimeout(done, 0);
        });
    });
    await user.keyboard(`{${key}}[Space]`);
}

const OUTLINE_ROW_HEIGHT = 28;
const CHAPTER_MOVE_TITLES = ['第一章', '甲节', '乙节', '丙节', '第二章'] as const;

function chapterMoveChapters(emptyFirst: boolean): ChapterDraft[] {
    const tall = chapterDraft({
        _id: 1,
        title: '第一章',
        sections: [
            sectionDraft(11, '甲节'),
            sectionDraft(12, '乙节'),
            sectionDraft(13, '丙节'),
        ],
    });
    const empty = chapterDraft({ _id: 2, title: '第二章', sections: [] });
    return emptyFirst ? [empty, tall] : [tall, empty];
}

function outlineRect(top: number, height: number): DOMRect {
    const left = 16;
    const width = 240;
    return {
        x: left,
        y: top,
        top,
        left,
        width,
        height,
        bottom: top + height,
        right: left + width,
        toJSON() {
            return {};
        },
    } as DOMRect;
}

function chapterFrames(chapters: readonly ChapterDraft[]): { title: string; sections: string[]; top: number; height: number }[] {
    let top = 0;
    return chapters.map((chapter) => {
        const height = OUTLINE_ROW_HEIGHT * (1 + chapter.sections.length);
        const frame = {
            title: chapter.title,
            sections: chapter.sections.map((section) => section.title),
            top,
            height,
        };
        top += height;
        return frame;
    });
}

function nodeIncludes(node: Element, title: string): boolean {
    return (node.textContent ?? '').includes(title);
}

function installChapterFrames(chapters: readonly ChapterDraft[]): () => void {
    const original = Element.prototype.getBoundingClientRect;
    const frames = chapterFrames(chapters);
    // 章容器高度 = 行高 × (1 + 小节数)，空章一行，top 按该高度累加。
    Element.prototype.getBoundingClientRect = function () {
        const frame = frames.find((item) => {
            if (!nodeIncludes(this, item.title)) return false;
            if (item.sections.some((title) => !nodeIncludes(this, title))) return false;
            return frames.every((other) => other.title === item.title || !nodeIncludes(this, other.title));
        });
        if (!frame) return outlineRect(0, 0);
        return outlineRect(frame.top, frame.height);
    };
    return () => {
        Element.prototype.getBoundingClientRect = original;
    };
}

async function nudgeChapter(chapters: ChapterDraft[], title: string, key: 'ArrowDown' | 'ArrowUp'): Promise<ChapterDraft[] | undefined> {
    const OutlinePanel = await loadOutline();
    const onChange = vi.fn<(next: ChapterDraft[]) => void>();
    const restoreRects = installChapterFrames(chapters);
    try {
        if (OutlinePanel) {
            const user = userEvent.setup();
            renderOutline(OutlinePanel, { chapters, onChange });
            const handle = sortableHandle(title, CHAPTER_MOVE_TITLES);
            expect(handle, `${title}应有拖动手柄`).toBeTruthy();
            if (handle) await keyboardNudge(user, handle, key);
        }
    } finally {
        restoreRects();
    }
    return onChange.mock.calls[0]?.[0];
}

function firstEnabledMenuItem(menu: HTMLElement): HTMLElement | null {
    return within(menu).queryAllByRole('menuitem').find((item) => !isDisabled(item)) ?? null;
}

function blockerReasonIsWrapped(menu: HTMLElement, reason: string): boolean {
    const matches = [...menu.querySelectorAll('*')].filter((node): node is HTMLElement => {
        return node instanceof HTMLElement && (node.textContent ?? '').trim() === reason;
    });
    const leaf = matches.find((node) => {
        return ![...node.querySelectorAll('*')].some((child) => (child.textContent ?? '').trim() === reason);
    });
    if (!leaf) return false;
    let current: HTMLElement | null = leaf;
    while (current) {
        if (current.classList.contains('truncate')) return false;
        if (current === menu) break;
        current = current.parentElement;
    }
    return true;
}

describe('course outline panel', () => {
    it('selects the second chapter and then its section', async () => {
        const OutlinePanel = await loadOutline();
        const onSelect = vi.fn<(chapterId: number, sectionId: number | null) => void>();
        if (OutlinePanel) {
            const user = userEvent.setup();
            renderOutline(OutlinePanel, { chapters: sampleChapters(), onSelect });
            const chapter = textOf('线性表');
            const section = textOf('顺序表');
            if (chapter) await user.click(chapter);
            if (section) await user.click(section);
        }

        expect(onSelect.mock.calls, SELECT_CASE).toEqual([[2, null], [2, 21]]);
    });

    it('marks the active chapter or section', async () => {
        const OutlinePanel = await loadOutline();
        const chapters = sampleChapters();
        if (OutlinePanel) {
            renderOutline(OutlinePanel, { chapters, activeId: 2, activeSectionId: null });
        }

        const heading = screen.queryByRole('heading', { name: '大纲' });
        expect(heading, '大纲 Panel').not.toBeNull();
        expect(heading?.closest('[data-slot="panel"]'), '大纲应在 Panel 内').not.toBeNull();
        expect(currentValue('线性表', TITLES), '选中章应有 aria-current').not.toBeNull();
        expect(hasClassToken('线性表', TITLES, 'bg-surface-active'), '选中章应有 bg-surface-active').toBe(true);
        expect(currentValue('顺序表', TITLES), '未选中的小节不应有 aria-current').toBeNull();

        if (!OutlinePanel) return;
        cleanup();
        renderOutline(OutlinePanel, { chapters, activeId: 2, activeSectionId: 21 });
        expect(currentValue('顺序表', TITLES), '选中小节应有 aria-current').not.toBeNull();
        expect(hasClassToken('顺序表', TITLES, 'bg-surface-active'), '选中小节应有 bg-surface-active').toBe(true);
        expect(currentValue('线性表', TITLES), '选中小节时章行不应有 aria-current').toBeNull();
    });

    it('adds one chapter from the outline action', async () => {
        const OutlinePanel = await loadOutline();
        const chapters = sampleChapters();
        const expected = addChapter(chapters);
        const onChange = vi.fn<(next: ChapterDraft[]) => void>();
        if (OutlinePanel) {
            const user = userEvent.setup();
            renderOutline(OutlinePanel, { chapters, onChange });
            const add = screen.queryByRole('button', { name: '加一章' });
            if (add) {
                expect(add).toHaveAttribute('data-variant', 'ghost');
                expect(add).toHaveAttribute('data-size', 'sm');
                await user.click(add);
            }
        }

        expect(onChange.mock.calls[0]?.[0], ADD_CHAPTER_CASE).toEqual(expected);
    });

    it('adds a section from a chapter menu and not from a section', async () => {
        const OutlinePanel = await loadOutline();
        const chapters = sampleChapters();
        const expected = addSection(chapters, 2);
        const onChange = vi.fn<(next: ChapterDraft[]) => void>();
        let sectionOffersAdd = false;
        if (OutlinePanel) {
            const user = userEvent.setup();
            renderOutline(OutlinePanel, { chapters, onChange });
            const chapterMenu = await openMenu(user, '线性表', TITLES);
            const addSectionItem = chapterMenu ? within(chapterMenu).queryByRole('menuitem', { name: /^加一节/ }) : null;
            if (addSectionItem) await user.click(addSectionItem);
            const sectionMenu = await openMenu(user, '顺序表', TITLES);
            sectionOffersAdd = sectionMenu ? within(sectionMenu).queryByRole('menuitem', { name: /^加一节/ }) !== null : false;
        }

        expect(onChange.mock.calls[0]?.[0], '章菜单「加一节」应让 onChange 多出一节').toEqual(expected);
        expect(sectionOffersAdd, '小节菜单不应有「加一节」').toBe(false);
    });

    it('adds a section when enter activates the focused chapter menu item', async () => {
        const OutlinePanel = await loadOutline();
        const chapters = sampleChapters();
        const onChange = vi.fn<(next: ChapterDraft[]) => void>();
        if (OutlinePanel) {
            const user = userEvent.setup();
            renderOutline(OutlinePanel, { chapters, onChange });
            const trigger = findMenuButton('线性表', TITLES);
            expect(trigger, '章行应有「⋯」').toBeTruthy();
            if (trigger) {
                for (let step = 0; step < 40 && document.activeElement !== trigger; step += 1) {
                    await user.tab();
                }
                expect(document.activeElement, 'Tab 应落到章的「⋯」').toBe(trigger);
                await user.keyboard('{Enter}');
                const menu = await screen.findByRole('menu');
                const first = firstEnabledMenuItem(menu);
                expect(first, '章菜单应有可用的第一项').not.toBeNull();
                expect(document.activeElement, '打开章菜单后第一个可用 menuitem 应是焦点').toBe(first);
                await user.keyboard('{Enter}');
            }
        }

        expect(onChange.mock.calls[0]?.[0], '对焦点中的第一项按 Enter 应让 onChange 多出一节').toEqual(addSection(chapters, 2));
    });

    it('disables delete and shows the blocker reason', async () => {
        const OutlinePanel = await loadOutline();
        let blockedDelete: HTMLElement | null = null;
        let reasonShown = false;
        if (OutlinePanel) {
            const user = userEvent.setup();
            renderOutline(OutlinePanel, {
                chapters: sampleChapters(),
                removalBlocker: (chapter) => (chapter._id === 2 ? BLOCKER : null),
            });
            const menu = await openMenu(user, '线性表', TITLES);
            if (menu) {
                blockedDelete = within(menu).queryByRole('menuitem', { name: /删除/ });
                reasonShown = blockerReasonIsWrapped(menu, BLOCKER);
            }
        }

        expect(blockedDelete, BLOCKED_DELETE_CASE).not.toBeNull();
        expect(isDisabled(blockedDelete), BLOCKED_DELETE_CASE).toBe(true);
        expect(reasonShown, '原因应单独换行显示，不能留在带 truncate 的单行 label 里').toBe(true);
    });

    it('asks before removing a chapter or a section', async () => {
        const OutlinePanel = await loadOutline();
        const chapters = sampleChapters();
        const withoutChapter = removeChapter(chapters, 1);
        const withoutSection = removeSection(chapters, 2, 21);
        const onChange = vi.fn<(next: ChapterDraft[]) => void>();
        if (OutlinePanel) {
            const user = userEvent.setup();
            renderOutline(OutlinePanel, { chapters, onChange });
            const chapterMenu = await openMenu(user, '绪论', TITLES);
            const chapterDelete = chapterMenu ? within(chapterMenu).queryByRole('menuitem', { name: /删除/ }) : null;
            if (chapterDelete) await user.click(chapterDelete);
            const cancelled = screen.queryByRole('dialog', { name: deleteTitle('绪论') });
            if (cancelled) {
                expect(cancelled).toHaveTextContent(DELETE_MESSAGE);
                const cancel = within(cancelled).queryByRole('button', { name: '取消' });
                if (cancel) await user.click(cancel);
                await waitFor(() => {
                    expect(screen.queryByRole('dialog')).toBeNull();
                });
            }
            expect(onChange, '取消删除不应调用 onChange').not.toHaveBeenCalled();

            const again = await openMenu(user, '绪论', TITLES);
            const deleteAgain = again ? within(again).queryByRole('menuitem', { name: /删除/ }) : null;
            if (deleteAgain) await user.click(deleteAgain);
            const confirmed = screen.queryByRole('dialog', { name: deleteTitle('绪论') });
            const confirmChapter = confirmed ? within(confirmed).queryByRole('button', { name: '删除' }) : null;
            if (confirmChapter) {
                expect(confirmChapter).toHaveAttribute('data-variant', 'danger');
                await user.click(confirmChapter);
            }

            const sectionMenu = await openMenu(user, '顺序表', TITLES);
            const sectionDelete = sectionMenu ? within(sectionMenu).queryByRole('menuitem', { name: /删除/ }) : null;
            if (sectionDelete) {
                expect(sectionDelete.classList.contains('text-danger-fg')).toBe(true);
                await user.click(sectionDelete);
            }
            const sectionDialog = screen.queryByRole('dialog', { name: deleteTitle('顺序表') });
            if (sectionDialog) {
                expect(sectionDialog).toHaveTextContent(DELETE_MESSAGE);
                const confirmSection = within(sectionDialog).queryByRole('button', { name: '删除' });
                if (confirmSection) await user.click(confirmSection);
            }
        }

        expect(onChange.mock.calls[0]?.[0], '确认后 onChange 应去掉这一章').toEqual(withoutChapter);
        expect(onChange.mock.calls[1]?.[0], '确认后 onChange 应去掉这一节').toEqual(withoutSection);
    });

    it('hides a zero count and shows the content total', async () => {
        const OutlinePanel = await loadOutline();
        const chapters = sampleChapters();
        const linear = chapters[1];
        if (OutlinePanel) renderOutline(OutlinePanel, { chapters });

        expect(linear, '第 2 章').toBeTruthy();
        if (!linear) return;
        expect(textOf('绪论'), '应列出第 1 章').not.toBeNull();
        expect(textOf('线性表'), '应列出第 2 章').not.toBeNull();
        expect(countText('绪论', TITLES), '计数为 0 的章不应显示').toBeNull();
        expect(countText('空小节', TITLES), '计数为 0 的小节不应显示').toBeNull();
        expect(countText('线性表', TITLES), '章计数').toBe(String(contentTotal(linear, null)));
        expect(countText('顺序表', TITLES), '小节计数').toBe(String(contentTotal(linear, 21)));
    });

    it('opens the mindmap tab from the panel footer', async () => {
        const OutlinePanel = await loadOutline();
        const onGenerateFromMindmap = vi.fn<() => void>();
        if (OutlinePanel) {
            const user = userEvent.setup();
            renderOutline(OutlinePanel, { chapters: sampleChapters(), onGenerateFromMindmap });
            const generate = screen.queryByRole('button', { name: GENERATE });
            if (generate) {
                expect(generate).toHaveAttribute('data-variant', 'ghost');
                expect(generate).toHaveAttribute('data-size', 'sm');
                await user.click(generate);
            }
        }

        expect(onGenerateFromMindmap, '「从专属导图生成章节…」应调用 onGenerateFromMindmap').toHaveBeenCalledTimes(1);
    });

    it('moves a chapter down by keyboard when it contains three sections', async () => {
        const chapters = chapterMoveChapters(false);
        const moved = await nudgeChapter(chapters, '第一章', 'ArrowDown');
        expect(moved, '多小节章下方是空章时，ArrowDown 一次后应是 moveChapter 的顺序').toEqual(
            moveChapter(chapters, 1, 1),
        );
    });

    it('moves a long chapter up by keyboard when an empty chapter is above', async () => {
        const chapters = chapterMoveChapters(true);
        const moved = await nudgeChapter(chapters, '第一章', 'ArrowUp');
        expect(moved, '空章在上时，多小节章 ArrowUp 一次后应是 moveChapter 的顺序').toEqual(
            moveChapter(chapters, 1, 0),
        );
    });

    it('moves a section down only inside its chapter', async () => {
        const OutlinePanel = await loadOutline();
        const chapters = keyboardChapters();
        const onChange = vi.fn<(next: ChapterDraft[]) => void>();
        const restoreRects = installStackedRects();
        try {
            if (OutlinePanel) {
                const user = userEvent.setup();
                renderOutline(OutlinePanel, { chapters, onChange });
                const handle = sortableHandle('甲节', KEYBOARD_TITLES);
                expect(handle, '甲节应有拖动手柄').toBeTruthy();
                if (handle) await keyboardNudge(user, handle);
            }
        } finally {
            restoreRects();
        }

        const moved = moveSection(chapters, 1, 11, 1);
        expect(onChange.mock.calls[0]?.[0], '小节 ArrowDown 只应在本章内换位').toEqual(moved);
        expect(onChange.mock.calls[0]?.[0]?.find((chapter) => chapter._id === 2)?.sections.map((section) => section._id), '小节不能换到别的章').toEqual([21]);
    });
});
