import { motion } from 'motion/react';
import { ArrowLeft, FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useBootstrap } from '@/lib/bootstrap';

const TEMPLATE_LABELS: Record<string, string> = {
  'problem_edit.html': '编辑题目',
  'problem_config.html': '题目配置',
  'problem_files.html': '题目文件',
  'problem_solution.html': '题解',
  'problem_statistics.html': '题目统计',
  'problem_import.html': '导入题目',
  'contest_edit.html': '编辑比赛',
  'contest_manage.html': '比赛管理',
  'contest_problemlist.html': '比赛题目',
  'contest_user.html': '比赛参赛者',
  'contest_balloon.html': '气球分发',
  'contest_clarification.html': '比赛答疑',
  'contest_print.html': '打印',
  'homework_edit.html': '编辑作业',
  'homework_files.html': '作业文件',
  'training_edit.html': '编辑训练',
  'training_files.html': '训练文件',
  'discussion_create.html': '发起讨论',
  'discussion_edit.html': '编辑讨论',
  'domain_create.html': '创建域',
  'domain_edit.html': '编辑域',
  'domain_user.html': '域用户',
  'domain_user_raw.html': '域用户',
  'domain_permission.html': '域权限',
  'domain_role.html': '域角色',
  'domain_group.html': '用户组',
  'domain_join.html': '加入域',
  'domain_join_applications.html': '加入申请',
  'manage_script.html': '运行脚本',
  'manage_setting.html': '系统设置',
  'manage_config.html': '系统配置',
  'manage_user_import.html': '导入用户',
  'manage_user_priv.html': '用户权限',
  'user_register_mail_sent.html': '注册邮件已发送',
  'user_lostpass_with_code.html': '重置密码',
  'user_sudo.html': '鉴权',
  'user_sudo_redirect.html': '鉴权跳转',
  'user_delete_pending.html': '删除账号',
  'user_changemail_mail_sent.html': '更换邮箱',
  'contest_mode.html': '比赛模式',
};

export function GenericPage() {
  const bs = useBootstrap();
  const tpl = bs.page.templateName;
  const data = bs.page.data;
  const label = TEMPLATE_LABELS[tpl] || tpl.replace(/\.html$/, '').replace(/_/g, ' ');

  // Try to extract useful info from data
  const title = data.pdoc?.title || data.tdoc?.title || data.ddoc?.title || data.udoc?.uname || '';
  const keys = Object.keys(data).filter((k) => !['domain', 'udict', '_', 'handler'].includes(k));

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => window.history.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold capitalize">{label}</h1>
          {title ? <p className="text-sm text-muted-foreground">{title}</p> : null}
        </div>
        <Badge variant="outline" className="ml-auto">{tpl}</Badge>
      </div>

      {keys.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {keys.slice(0, 12).map((key) => {
            const val = data[key];
            const isArr = Array.isArray(val);
            const isObj = val && typeof val === 'object' && !isArr;
            let display: string;
            if (val == null) display = '—';
            else if (isArr) display = `${val.length} 项`;
            else if (isObj) display = `{${Object.keys(val).length} 字段}`;
            else display = String(val).slice(0, 120);

            return (
              <Card key={key}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{key}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="truncate text-sm">{display}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <FileText className="size-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">此页面尚无额外数据</p>
          </CardContent>
        </Card>
      )}
    </motion.div>
  );
}
