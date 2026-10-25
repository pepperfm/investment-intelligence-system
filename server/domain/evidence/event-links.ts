export interface EventLinks {
  scope: 'market' | 'sector' | 'issuer' | 'unassigned'
  sectors: string[]
  issuerInns: string[]
  reasons: string[]
}

/** Mechanism-based context is not a company-specific allegation or a price-direction prediction. */
export function regulatoryLinks(event: {
  title: string
  body: string
  category: string
}, identities: {
  inn: string
  names: string[]
}[] = []): EventLinks {
  const text = `${event.title} ${event.body}`
  const issuerInns = identities.filter(identity => identity.names.some(name => name.length >= 6 && text.toLocaleLowerCase('ru').includes(name.toLocaleLowerCase('ru')))).map(identity => identity.inn)
  if (issuerInns.length && /лицензи|предписани|ограничени|отзыв|регистраци/i.test(text)) {
    return {
      scope: 'issuer',
      sectors: [],
      issuerInns,
      reasons: ['Юридическое лицо явно названо в регуляторной публикации; совпадение общеупотребительного слова не используется'],
    }
  }
  if (event.category === 'monetary_policy') {
    return {
      scope: 'market',
      sectors: ['bank', 'exporter', 'it', 'general'],
      issuerInns: [],
      reasons: ['Ставка и инфляция влияют на стоимость фондирования и дисконтирования всего рынка; знак влияния на компанию требует отдельной проверки'],
    }
  }
  if (event.category === 'banking_regulation') {
    return {
      scope: 'sector',
      sectors: ['bank'],
      issuerInns: [],
      reasons: ['Публикация относится к банковскому регулированию; это отраслевой контекст, не утверждение о конкретном банке'],
    }
  }
  if (event.category === 'financial_market') {
    return {
      scope: 'market',
      sectors: [],
      issuerInns: [],
      reasons: ['Общее регулирование финансового рынка; конкретный эмитент не установлен'],
    }
  }
  return {
    scope: 'unassigned',
    sectors: [],
    issuerInns: [],
    reasons: ['Недостаточно оснований для связи с отраслью или эмитентом'],
  }
}
