export default defineAppConfig({
  ui: {
    colors: {
      // Green/red are reserved for profit/loss, so the brand accent is indigo.
      primary: 'indigo',
      neutral: 'zinc',
    },
    card: {
      slots: {
        root: 'rounded-xl',
        header: 'px-4 py-3 sm:px-5',
        body: 'p-4 sm:p-5',
        footer: 'px-4 py-3 sm:px-5',
      },
    },
    table: {
      slots: {
        th: 'px-3 py-2 text-xs font-medium text-muted',
        td: 'px-3 py-2.5 text-sm',
      },
    },
    badge: {
      defaultVariants: {
        variant: 'subtle',
      },
    },
    dashboardPanel: {
      slots: {
        body: 'gap-4 sm:gap-5',
      },
    },
  },
})
