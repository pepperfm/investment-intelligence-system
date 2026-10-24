export interface NavEntry {
  label: string
  icon: string
  to: string
}

export const NAV_ITEMS: NavEntry[] = [
  {
    label: 'Обзор',
    icon: 'i-lucide-layout-dashboard',
    to: '/',
  },
  {
    label: 'Исследования',
    icon: 'i-lucide-flask-conical',
    to: '/research',
  },
  {
    label: 'Гипотезы',
    icon: 'i-lucide-lightbulb',
    to: '/hypotheses',
  },
  {
    label: 'Инструменты',
    icon: 'i-lucide-candlestick-chart',
    to: '/instruments',
  },
  {
    label: 'Paper-портфель',
    icon: 'i-lucide-wallet',
    to: '/portfolio',
  },
  {
    label: 'Оценки и ретро',
    icon: 'i-lucide-target',
    to: '/evaluations',
  },
  {
    label: 'Стратегии',
    icon: 'i-lucide-git-branch',
    to: '/strategies',
  },
  {
    label: 'Память',
    icon: 'i-lucide-brain',
    to: '/memory',
  },
  {
    label: 'Настройки',
    icon: 'i-lucide-settings',
    to: '/settings',
  },
]
