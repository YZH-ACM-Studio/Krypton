/**
 * Sudo verification page — shown when a privileged action requires
 * re-authentication (e.g. accessing security settings).
 */

import { useEffect, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { useBootstrap } from '@/lib/bootstrap';
import { buildSudoReplayFields, resolveSudoReplayTarget } from '@/lib/sudo-replay';

// 手机密码框用 text-lg（--fs-lg = 16px）。1rem 等于根字号 --fs-md（14px），挡不住 iOS 聚焦放大。
const SUDO_INPUT_CLASS = 'text-lg md:text-sm';

// 结构测试按每个 return 的源码字面量检查，Page / PageHeader / Panel 必须写在函数体内。
export function SudoPage() {
  return (
    <Page width="form">
      <PageHeader title="身份验证" description="此操作需要重新验证您的身份，请输入密码以继续。" />
      <Panel>
        <form method="post" className="flex flex-col gap-5">
          <FormField label="密码" htmlFor="sudo-password">
            <Input
              id="sudo-password"
              name="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              placeholder="请输入您的密码"
              size="lg"
              className={SUDO_INPUT_CLASS}
            />
          </FormField>
          <Button type="submit" variant="primary" className="w-full sm:w-auto">
            验证
          </Button>
        </form>
      </Panel>
    </Page>
  );
}

/**
 * Sudo redirect page — auto-submits a form to replay the original
 * request after sudo verification succeeds.
 */
export function SudoRedirectPage() {
  const data = useBootstrap().page.data as {
    args?: unknown;
    method?: unknown;
    redirect?: unknown;
  };
  const formRef = useRef<HTMLFormElement | null>(null);
  const submittedRef = useRef(false);
  const target = resolveSudoReplayTarget(data.method, data.redirect);
  const fields = useMemo(() => buildSudoReplayFields(data.args), [data.args]);

  useEffect(() => {
    if (submittedRef.current || !formRef.current) return;
    submittedRef.current = true;
    formRef.current.requestSubmit();
  }, []);

  return (
    <Page width="form">
      <PageHeader title="身份验证成功，正在继续原操作…" />
      <Panel>
        <form ref={formRef} method="post" action={target} className="flex flex-col gap-3">
          {fields.map((field, index) => (
            <input key={`${field.name}-${index}`} type="hidden" name={field.name} value={field.value} />
          ))}
          <Button type="submit" variant="secondary" className="w-full sm:w-auto">
            立即继续
          </Button>
        </form>
      </Panel>
    </Page>
  );
}
