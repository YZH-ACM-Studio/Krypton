export type SolutionVoteClick = 1 | -1;
export type SolutionVoteState = -1 | 0 | 1;

export function nextSolutionVote(current: unknown, clicked: SolutionVoteClick): SolutionVoteState {
    if (clicked !== 1 && clicked !== -1) {
        throw new TypeError('solution vote must be 1 or -1');
    }
    const previous = current === 1 || current === -1 ? current : 0;
    return previous === clicked ? 0 : clicked;
}
