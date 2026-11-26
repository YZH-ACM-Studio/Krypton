import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UserBindPage } from '../src/pages/userbind';
import { createSigningAttemptId } from '../src/pages/collect/signing-attempt-id';

vi.mock('../src/lib/bootstrap', () => ({
  useBootstrap: () => ({ page: { data: {
    schools: [{ _id: '0123456789abcdef01234567', name: '示例学校' }],
    alreadyBound: false, hasPending: false, currentStudentId: null, currentRealName: null,
    signing: { title: '安全知情书', schoolId: '0123456789abcdef01234567', returnTo: '/collect/0123456789abcdef01234567/sign' },
  } } }),
}));

describe('signing entry contracts', () => {
  it('submits one fixed school from the actual student binding form', () => {
    const { container } = render(<UserBindPage />);
    const form = container.querySelector('form');
    if (!form) throw new Error('Binding form missing');
    const body = new FormData(form);
    expect(body.getAll('schoolId')).toEqual(['0123456789abcdef01234567']);
    expect(body.get('collectSign')).toBe('/collect/0123456789abcdef01234567/sign');
  });

  it('creates an attempt on HTTP where randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(0xab) });
    expect(createSigningAttemptId()).toBe('abababab-abab-4bab-abab-abababababab');
  });
});
