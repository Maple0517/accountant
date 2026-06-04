import { registerI18nNamespace, type TranslationDictionary } from '@/i18n/client'

const enAuth: TranslationDictionary = {
  'auth.subtitle': 'Smart personal finance tracker',
  'auth.email': 'Email',
  'auth.password': 'Password',
  'auth.signIn': 'Sign In',
  'auth.signUp': 'Sign Up',
  'auth.createAccount': 'Create Account',
  'auth.haveAccount': 'Already have an account?',
  'auth.noAccount': "Don't have an account?",
  'auth.checkEmail': 'Check your email for the confirmation link.',
  'auth.genericError': 'An error occurred during authentication.',
}

const zhAuth: TranslationDictionary = {
  ...enAuth,
  'auth.subtitle': '智能个人财务追踪',
  'auth.email': '邮箱',
  'auth.password': '密码',
  'auth.signIn': '登录',
  'auth.signUp': '注册',
  'auth.createAccount': '创建账户',
  'auth.haveAccount': '已有账户？',
  'auth.noAccount': '还没有账户？',
  'auth.checkEmail': '请检查邮箱中的确认链接。',
  'auth.genericError': '认证时发生错误。',
}

registerI18nNamespace({ en: enAuth, zh: zhAuth })
