import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

describe('programming problem reactions', () => {
  it('renders the reaction bar on ordinary UINext problem detail only', () => {
    const detail = readFileSync(resolve(root, 'src/pages/problem-detail.tsx'), 'utf8');
    expect(detail).to.include('function ProblemReactionBar');
    expect(detail).to.include("label: '点赞'");
    expect(detail).to.include("label: '点踩'");
    expect(detail).to.include("label: '点问号'");
    expect(detail).not.to.include('何意味');
    expect(detail).to.include("operation: 'reaction'");
    expect(detail).to.include('showProblemReactions && reactionCounts');
    expect(detail).to.include('!inContest && !virtualContestActive && !examMode?.enabled');
    expect(detail).to.include('canReact={!!bs.user?.signedIn}');
    const list = readFileSync(resolve(root, 'src/pages/problems.tsx'), 'utf8');
    expect(list).to.not.include('ProblemReactionBar');
  });
});
