import { motion } from 'motion/react';
import { Swords } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useBootstrap } from '@/lib/bootstrap';

export function LoginPage() {
  const bs = useBootstrap();

  return (
    <motion.div
      className="mx-auto max-w-sm space-y-6 pt-8"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <div className="text-center">
        <Swords className="mx-auto size-8 text-primary" />
        <h1 className="mt-3 text-2xl font-bold">登录 Krypton</h1>
        <p className="mt-1 text-sm text-muted-foreground">{bs.domain.name}</p>
      </div>

      <Card>
        <CardContent className="p-6">
          <form method="post" className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="uname" className="text-sm font-medium">用户名或邮箱</label>
              <Input id="uname" name="uname" autoComplete="username" autoFocus required />
            </div>
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">密码</label>
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
            <Button type="submit" className="w-full">登录</Button>
          </form>
          <div className="mt-4 flex items-center justify-between text-sm">
            <a href={bs.urls.register} className="text-primary hover:underline">注册账号</a>
            <a href="/lostpass" className="text-muted-foreground hover:text-primary">忘记密码?</a>
          </div>
        </CardContent>
      </Card>

      {bs.page.data.oauth?.length ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-center text-sm text-muted-foreground">第三方登录</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap justify-center gap-2">
            {(bs.page.data.oauth as Array<{ type: string; name: string }>).map((o) => (
              <Button key={o.type} asChild variant="outline" size="sm">
                <a href={`/oauth/${o.type}/login`}>{o.name || o.type}</a>
              </Button>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </motion.div>
  );
}

export function RegisterPage() {
  const bs = useBootstrap();
  const tpl = bs.page.templateName;

  // Step 2: user_register_with_code.html — user has a code, show username/password form
  if (tpl === 'user_register_with_code.html') {
    const mail = bs.page.data.mail || '';
    return (
      <motion.div
        className="mx-auto max-w-sm space-y-6 pt-8"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <div className="text-center">
          <Swords className="mx-auto size-8 text-primary" />
          <h1 className="mt-3 text-2xl font-bold">完成注册</h1>
          {mail ? <p className="mt-1 text-sm text-muted-foreground">{mail}</p> : null}
        </div>

        <Card>
          <CardContent className="p-6">
            <form method="post" className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="uname" className="text-sm font-medium">用户名</label>
                <Input id="uname" name="uname" autoComplete="username" autoFocus required placeholder="设置你的用户名" />
              </div>
              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium">密码</label>
                <Input id="password" name="password" type="password" autoComplete="new-password" required />
              </div>
              <div className="space-y-2">
                <label htmlFor="verifyPassword" className="text-sm font-medium">确认密码</label>
                <Input id="verifyPassword" name="verifyPassword" type="password" autoComplete="new-password" required />
              </div>
              <Button type="submit" className="w-full">注册</Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  // Step 1: user_register.html — enter email
  return (
    <motion.div
      className="mx-auto max-w-sm space-y-6 pt-8"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <div className="text-center">
        <Swords className="mx-auto size-8 text-primary" />
        <h1 className="mt-3 text-2xl font-bold">注册 Krypton</h1>
        <p className="mt-1 text-sm text-muted-foreground">{bs.domain.name}</p>
      </div>

      <Card>
        <CardContent className="p-6">
          <form method="post" className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="mail" className="text-sm font-medium">邮箱</label>
              <Input id="mail" name="mail" type="email" autoComplete="email" autoFocus required />
            </div>
            <Button type="submit" className="w-full">发送验证邮件</Button>
          </form>
          <div className="mt-4 text-center text-sm">
            <span className="text-muted-foreground">已有账号？</span>{' '}
            <a href={bs.urls.login} className="text-primary hover:underline">去登录</a>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export function LogoutPage() {
  const bs = useBootstrap();

  return (
    <motion.div
      className="mx-auto max-w-sm space-y-6 pt-12"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <Card>
        <CardContent className="p-6 text-center">
          <Swords className="mx-auto size-8 text-muted-foreground" />
          <h1 className="mt-3 text-xl font-semibold">确认退出</h1>
          <p className="mt-1 text-sm text-muted-foreground">你确定要退出登录吗？</p>
          <div className="mt-6 flex gap-3">
            <Button asChild variant="outline" className="flex-1">
              <a href={bs.urls.home}>取消</a>
            </Button>
            <form method="post" className="flex-1">
              <Button type="submit" variant="destructive" className="w-full">退出</Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export function LostPasswordPage() {
  const bs = useBootstrap();

  return (
    <motion.div
      className="mx-auto max-w-sm space-y-6 pt-8"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <div className="text-center">
        <h1 className="text-2xl font-bold">找回密码</h1>
        <p className="mt-1 text-sm text-muted-foreground">输入你注册时使用的邮箱</p>
      </div>

      <Card>
        <CardContent className="p-6">
          <form method="post" className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="mail" className="text-sm font-medium">邮箱</label>
              <Input id="mail" name="mail" type="email" autoFocus required />
            </div>
            <Button type="submit" className="w-full">发送重置邮件</Button>
          </form>
          <div className="mt-4 text-center text-sm">
            <a href={bs.urls.login} className="text-primary hover:underline">返回登录</a>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
