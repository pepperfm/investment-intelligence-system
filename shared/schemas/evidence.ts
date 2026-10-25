import { z } from 'zod'

const decimal = z.string().regex(/^-?\d+(?:\.\d+)?$/).max(40)
const dateOnly = z.iso.date()
const sourceUrl = z.url().refine((value) => {
  const url = new URL(value)
  return url.protocol === 'https:' && !url.username && !url.password
}, 'Требуется HTTPS-ссылка на первичный источник')

export const issuerFactInput = z.object({
  metricKey: z.enum(['revenue', 'ebitda', 'adjusted_ebitda', 'operating_profit', 'net_profit', 'adjusted_net_profit', 'operating_cash_flow', 'debt', 'cash', 'net_debt', 'dividend_per_share', 'total_assets', 'equity', 'bank_interest_income', 'bank_commission_income', 'net_interest_income', 'loans', 'deposits', 'capital_adequacy']),
  value: decimal,
  unit: z.string().trim().min(1).max(100),
  originalUnit: z.string().trim().min(1).max(100),
  locator: z.string().trim().min(3).max(1000),
  periodStart: dateOnly.optional(),
  periodEnd: dateOnly.optional(),
  basis: z.enum(['reported', 'non_ifrs']).default('reported'),
  periodKind: z.enum(['duration', 'instant']).optional(),
}).strict().transform(fact => ({
  ...fact,
  basis: fact.metricKey.startsWith('adjusted_') ? 'non_ifrs' as const : fact.basis,
}))

export const manualDocumentInput = z.object({
  instrumentId: z.uuid(),
  issuer: z.object({
    name: z.string().trim().min(2).max(300),
    inn: z.string().regex(/^\d{10}(\d{2})?$/),
    ogrn: z.string().regex(/^\d{13}(\d{2})?$/).optional(),
  }).strict(),
  title: z.string().trim().min(2).max(500),
  sourceUrl,
  reportingStandard: z.enum(['IFRS', 'RAS', 'BANK_REGULATORY']),
  consolidated: z.boolean(),
  periodStart: dateOnly,
  periodEnd: dateOnly,
  publishedAt: z.iso.datetime({ offset: true }),
  extractedText: z.string().max(200_000).default(''),
  confirmed: z.literal(true),
  facts: z.array(issuerFactInput).min(1).max(100),
}).strict().superRefine((value, ctx) => {
  if (value.periodStart > value.periodEnd || value.periodEnd > value.publishedAt.slice(0, 10)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Неверные даты отчётного периода',
    })
  }
  if (Date.parse(value.publishedAt) > Date.now()) {
    ctx.addIssue({
      code: 'custom',
      message: 'Дата публикации в будущем',
    })
  }
  for (const fact of value.facts) {
    const start = fact.periodStart ?? value.periodStart
    const end = fact.periodEnd ?? value.periodEnd
    if (start > end || end > value.periodEnd || end > value.publishedAt.slice(0, 10)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Неверный период отдельного показателя',
      })
    }
  }
  if (new Set(value.facts.map(fact => [fact.metricKey, fact.periodStart ?? value.periodStart, fact.periodEnd ?? value.periodEnd, fact.basis].join(':'))).size !== value.facts.length) {
    ctx.addIssue({
      code: 'custom',
      message: 'Показатели документа не должны повторяться',
    })
  }
})

export type ManualDocumentInput = z.infer<typeof manualDocumentInput>
