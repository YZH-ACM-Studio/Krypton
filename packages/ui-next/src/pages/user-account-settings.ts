export const STUDENT_IDENTITY_SETTING_KEYS = ['school', 'studentId', 'realName', 'phone'] as const;

const STUDENT_IDENTITY_SETTING_KEY_SET = new Set<string>(STUDENT_IDENTITY_SETTING_KEYS);

const SETTING_LABELS: Record<string, string> = {
  viewLang: '界面语言',
  timeZone: '时区',
  codeLang: '默认编程语言',
  codeTemplate: '默认代码模板',
  rounded: '圆角',
  skipAnimate: '减少动画',
  showTimeAgo: '相对时间',
  fontFamily: '界面字体',
  codeFontFamily: '代码字体',
  theme: '主题',
  preferredEditorType: '编辑器布局',
  showInvisibleChar: '显示不可见字符',
  formatCode: '自动格式化代码',
  avatar: '头像',
  qq: 'QQ',
  gender: '性别',
  bio: '个人简介',
  backgroundImage: '资料背景',
  displayName: '本域展示名',
};

const SETTING_HINTS: Record<string, string> = {
  viewLang: '只影响你自己看到的界面语言。',
  timeZone: '用于时间显示，不会改服务器时钟。',
  codeLang: '打开编程题时默认选中的语言。',
  codeTemplate: '留空则使用该语言的内置模板。',
  rounded: '界面卡片和按钮使用圆角。',
  skipAnimate: '关闭大部分过渡动画。',
  showTimeAgo: '把时间显示成「3 分钟前」这类相对写法。',
  fontFamily: '正文和导航使用的字体。',
  codeFontFamily: '代码块和编辑器使用的等宽字体。',
  theme: '浅色或深色外观。',
  preferredEditorType: 'Markdown 编辑器默认是分栏预览还是纯编辑器。',
  showInvisibleChar: '在代码里标出空格和制表符。',
  formatCode: '粘贴或保存时代码自动排版。',
  avatar: '也可以用 gravatar:邮箱、qq:号、github:用户名 或 url:链接。',
  qq: '可选。会出现在你的公开资料。',
  gender: '可选。',
  bio: '支持 Markdown，显示在公开资料页。',
  backgroundImage: '公开资料页顶部背景。可填站内路径或图片 URL。',
  displayName: '只在当前域显示，不会改登录用户名。',
};

const FAMILY_LABELS: Record<string, string> = {
  setting_display: '显示',
  setting_usage: '做题偏好',
  setting_info: '公开资料',
  setting_customize: '外观',
  setting_markdown: '编辑器',
  setting_highlight: '代码高亮',
  setting_basic: '基本',
  setting_external_rating: '外站 Rating',
  general: '通用',
};

const FAMILY_DESCRIPTIONS: Record<string, string> = {
  setting_display: '只影响你自己的界面，不会对外公开。',
  setting_usage: '提交和编辑代码时的默认选择。',
  setting_info: '会出现在你的公开资料页。',
  setting_customize: '公开资料页的装饰。',
  setting_markdown: '写题解和简介时的编辑器。',
  setting_highlight: '代码显示相关选项。',
};

const OPTION_LABELS: Record<string, string> = {
  light: '浅色',
  dark: '深色',
  sv: '分栏预览',
  monaco: 'Monaco 编辑器',
  '0': '男',
  '1': '女',
  '2': '其他',
  'Boy ♂': '男',
  'Girl ♀': '女',
  Other: '其他',
  Light: '浅色',
  Dark: '深色',
  'Split View': '分栏预览',
  'Monaco Editor': 'Monaco 编辑器',
  zh_CN: '简体中文',
  zh_TW: '繁体中文',
  en: 'English',
  ko: '한국어',
  ja: '日本語',
};

export function isStudentIdentitySettingKey(key: string): boolean {
  return STUDENT_IDENTITY_SETTING_KEY_SET.has(key);
}

export function settingLabel(key: string, fallback?: string): string {
  return SETTING_LABELS[key] || fallback || key;
}

export function settingHint(key: string, fallback?: string): string | undefined {
  return SETTING_HINTS[key] || fallback || undefined;
}

export function settingFamilyLabel(family: string): string {
  return FAMILY_LABELS[family] || family;
}

export function settingFamilyDescription(family: string): string | undefined {
  return FAMILY_DESCRIPTIONS[family];
}

export function settingOptionLabel(value: string, fallback?: string): string {
  return OPTION_LABELS[value] || OPTION_LABELS[fallback || ''] || fallback || value;
}

export function shouldRenderAccountSetting(setting: { key: string; flag: number }): boolean {
  if (setting.flag & 1) return false;
  if (isStudentIdentitySettingKey(setting.key)) return false;
  return true;
}
