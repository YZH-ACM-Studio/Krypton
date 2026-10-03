import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { useBootstrap } from '@/lib/bootstrap';

interface AuthPageData {
  mail?: string;
  oauth?: Array<{ type: string; name: string }>;
  uname?: string;
}

// 手机输入用 text-lg（--fs-lg = 16px）。1rem 等于根字号 --fs-md（14px），挡不住 iOS 聚焦放大。
const AUTH_INPUT_CLASS = 'text-lg md:text-sm';

// 结构测试按每个 return 的源码字面量检查，Page / PageHeader / Panel 必须写在函数体内。
export function LoginPage() {
  const bs = useBootstrap();
  const oauth = (bs.page.data as AuthPageData).oauth;

  return (
    <Page width="form">
      <PageHeader title="登录 Krypton" description={bs.domain.name} />
      <Panel>
        <form method="post" className="flex flex-col gap-5">
          <FormField label="用户名或邮箱" htmlFor="uname">
            <Input id="uname" name="uname" autoComplete="username" autoFocus required size="lg" className={AUTH_INPUT_CLASS} />
          </FormField>
          <FormField label="密码" htmlFor="password">
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              size="lg"
              className={AUTH_INPUT_CLASS}
            />
          </FormField>
          <Button type="submit" variant="primary" size="lg" className="w-full sm:w-auto">
            登录
          </Button>
        </form>
        <div className="mt-4 flex items-center justify-between text-sm">
          <a href={bs.urls.register} className="text-brand-fg underline-offset-4 hover:underline">
            注册账号
          </a>
          <a href="/lostpass" className="text-fg-muted hover:text-brand-fg">
            忘记密码?
          </a>
        </div>
      </Panel>
      {oauth && oauth.length > 0 ? (
        <Panel title="第三方登录">
          <div className="flex flex-wrap justify-center gap-2">
            {oauth.map((item) => (
              <Button key={item.type} asChild variant="secondary">
                <a href={`/oauth/${item.type}/login`}>{item.name || item.type}</a>
              </Button>
            ))}
          </div>
        </Panel>
      ) : null}
    </Page>
  );
}

export function RegisterPage() {
  const bs = useBootstrap();
  const tpl = bs.page.templateName;

  if (tpl === 'user_register_with_code.html') {
    const mail = (bs.page.data as AuthPageData).mail || '';
    return (
      <Page width="form">
        <PageHeader title="完成注册" description={mail ? <span className="break-all">{mail}</span> : undefined} />
        <Panel>
          <form method="post" className="flex flex-col gap-5">
            <FormField label="用户名" htmlFor="uname">
              <Input
                id="uname"
                name="uname"
                autoComplete="username"
                autoFocus
                required
                placeholder="设置你的用户名"
                size="lg"
                className={AUTH_INPUT_CLASS}
              />
            </FormField>
            <FormField label="密码" htmlFor="password">
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                size="lg"
                className={AUTH_INPUT_CLASS}
              />
            </FormField>
            <FormField label="确认密码" htmlFor="verifyPassword">
              <Input
                id="verifyPassword"
                name="verifyPassword"
                type="password"
                autoComplete="new-password"
                required
                size="lg"
                className={AUTH_INPUT_CLASS}
              />
            </FormField>
            <Button type="submit" variant="primary" className="w-full sm:w-auto">
              注册
            </Button>
          </form>
        </Panel>
      </Page>
    );
  }

  return (
    <Page width="form">
      <PageHeader title="注册 Krypton" description={bs.domain.name} />
      <Panel>
        <form method="post" className="flex flex-col gap-5">
          <FormField label="邮箱" htmlFor="mail">
            <Input id="mail" name="mail" type="email" autoComplete="email" autoFocus required size="lg" className={AUTH_INPUT_CLASS} />
          </FormField>
          <Button type="submit" variant="primary" className="w-full sm:w-auto">
            发送验证邮件
          </Button>
        </form>
        <div className="mt-4 text-center text-sm">
          <span className="text-fg-muted">已有账号？</span>{' '}
          <a href={bs.urls.login} className="text-brand-fg underline-offset-4 hover:underline">
            去登录
          </a>
        </div>
      </Panel>
    </Page>
  );
}

export function LogoutPage() {
  const bs = useBootstrap();

  return (
    <Page width="form">
      <PageHeader title="确认退出" description="你确定要退出登录吗？" />
      <Panel>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild variant="secondary" className="w-full sm:w-auto">
            <a href={bs.urls.home}>取消</a>
          </Button>
          <form method="post">
            <Button type="submit" variant="danger" className="w-full sm:w-auto">
              退出
            </Button>
          </form>
        </div>
      </Panel>
    </Page>
  );
}

export function LostPasswordPage() {
  const bs = useBootstrap();

  return (
    <Page width="form">
      <PageHeader title="找回密码" description="输入你注册时使用的邮箱" />
      <Panel>
        <form method="post" className="flex flex-col gap-5">
          <FormField label="邮箱" htmlFor="mail">
            <Input id="mail" name="mail" type="email" autoFocus required size="lg" className={AUTH_INPUT_CLASS} />
          </FormField>
          <Button type="submit" variant="primary" className="w-full sm:w-auto">
            发送重置邮件
          </Button>
        </form>
        <div className="mt-4 text-center text-sm">
          <a href={bs.urls.login} className="text-brand-fg underline-offset-4 hover:underline">
            返回登录
          </a>
        </div>
      </Panel>
    </Page>
  );
}

export function RegisterMailSentPage() {
  const bs = useBootstrap();
  const mail = (bs.page.data as AuthPageData).mail || '';

  return (
    <Page width="form">
      <PageHeader title="验证邮件已发送" />
      <Panel>
        <Alert tone="info">
          我们已向 <strong className="break-all">{mail}</strong> 发送了一封验证邮件，请查看你的收件箱并点击链接完成注册。
        </Alert>
        <div className="mt-4">
          <Button asChild variant="secondary">
            <a href={bs.urls.login}>返回登录</a>
          </Button>
        </div>
      </Panel>
    </Page>
  );
}

export function LostPasswordMailSentPage() {
  const bs = useBootstrap();
  const mail = (bs.page.data as AuthPageData).mail || '';

  return (
    <Page width="form">
      <PageHeader title="重置邮件已发送" />
      <Panel>
        <Alert tone="info">
          {mail ? (
            <>
              我们已向 <strong className="break-all">{mail}</strong> 发送了一封密码重置邮件，请查看收件箱并按邮件中的链接继续。
            </>
          ) : (
            '如果邮箱匹配已有账号，我们会发送密码重置链接，请稍后查看收件箱。'
          )}
        </Alert>
        <div className="mt-4">
          <Button asChild variant="secondary">
            <a href={bs.urls.login}>返回登录</a>
          </Button>
        </div>
      </Panel>
    </Page>
  );
}

export function LostPasswordWithCodePage() {
  const bs = useBootstrap();
  const uname = (bs.page.data as AuthPageData).uname || '';

  return (
    <Page width="form">
      <PageHeader title="重置密码" description={uname ? `用户: ${uname}` : undefined} />
      <Panel>
        <form method="post" className="flex flex-col gap-5">
          <FormField label="新密码" htmlFor="password">
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              autoFocus
              required
              size="lg"
              className={AUTH_INPUT_CLASS}
            />
          </FormField>
          <FormField label="确认密码" htmlFor="verifyPassword">
            <Input
              id="verifyPassword"
              name="verifyPassword"
              type="password"
              autoComplete="new-password"
              required
              size="lg"
              className={AUTH_INPUT_CLASS}
            />
          </FormField>
          <Button type="submit" variant="primary" className="w-full sm:w-auto">
            重置密码
          </Button>
        </form>
      </Panel>
    </Page>
  );
}

export function UserDeletePendingPage() {
  return (
    <Page width="form">
      <PageHeader title="账号删除已提交" />
      <Panel>
        <Alert tone="warning">你的账号将在 7 天后被永久删除。在此期间，你可以取消删除操作。</Alert>
      </Panel>
    </Page>
  );
}

export function ChangeMailSentPage() {
  return (
    <Page width="form">
      <PageHeader title="验证邮件已发送" />
      <Panel>
        <Alert tone="success">请查看新邮箱的收件箱，点击链接完成邮箱更换。</Alert>
      </Panel>
    </Page>
  );
}
