import { load } from 'cheerio'
import type { RegulatoryEvent } from '../../../../shared/types/evidence'
import type { SourceResponse } from '../http'
import { provenance } from './daily'
import { parseXml } from './xml'

export const CBR_RSS_URL = 'https://www.cbr.ru/rss/RssPress'

export function classifyRegulatoryEvent(text: string): RegulatoryEvent['category'] {
  if (/ключев\S* ставк|денежно.кредитн|инфляци/i.test(text)) {
    return 'monetary_policy'
  }
  if (/лицензи|кредитн\S* организац|банковск|норматив/i.test(text)) {
    return 'banking_regulation'
  }
  if (/ценн\S* бумаг|финансов\S* рын|бирж|брокер/i.test(text)) {
    return 'financial_market'
  }
  return 'other'
}

export function parseCbrRss(response: SourceResponse): RegulatoryEvent[] {
  const $ = parseXml(response.body)
  if (!$('rss channel').length) {
    throw new Error('Invalid CBR RSS channel')
  }
  const seen = new Set<string>()
  return $('item').toArray().map((node) => {
    const title = $(node).find('title').text().trim()
    const body = load($(node).find('description').text()).text().trim().slice(0, 12_000)
    const url = $(node).find('link').text().trim()
    const parsedUrl = new URL(url)
    if (parsedUrl.protocol !== 'https:' || !['cbr.ru', 'www.cbr.ru'].includes(parsedUrl.hostname)) {
      throw new Error('Unexpected RSS source URL')
    }
    const externalId = $(node).find('guid').text().trim() || url
    const date = new Date($(node).find('pubDate').text())
    if (!title || !Number.isFinite(date.getTime())) {
      throw new Error('Invalid RSS publication')
    }
    return {
      title,
      body,
      category: classifyRegulatoryEvent(`${title} ${body}`),
      provenance: provenance(response, 'cbr_news', url, externalId, {
        title,
        body,
        publishedAt: date.toISOString(),
      }, date.toISOString()),
    }
  }).filter((event) => {
    const key = `${event.provenance.externalId}:${event.provenance.contentHash}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}
