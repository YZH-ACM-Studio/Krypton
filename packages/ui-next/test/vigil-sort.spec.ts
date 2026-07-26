import { describe, expect, it } from 'vitest';
import { parseVigilSortKey, VIGIL_SORT_KEYS } from '../src/pages/vigil/sort.ts';

describe('vigil sort URL parser', () => {
  it('rejects tampered values and defaults to student id', () => {
    expect(VIGIL_SORT_KEYS).to.deep.equal(['status_priority', 'student_id', 'name', 'exam_time', 'event_count']);
    expect(parseVigilSortKey(null)).to.equal('student_id');
    expect(parseVigilSortKey('bogus')).to.equal('student_id');
    expect(parseVigilSortKey('status_priority')).to.equal('status_priority');
  });
});
