import type { EntryScenario, ExitScenario } from '../../../shared/types/investment'
import { addTradingDays, type CalendarOptions } from './calendar'

export function scenarioDeadline(asOf: Date, entry: EntryScenario, exit: ExitScenario, calendar: CalendarOptions) {
  // Entry day is the first held bar, not an extra day after the holding horizon.
  const entryDays = entry.type === 'market_next_open' ? 1 : entry.validDays
  return addTradingDays(asOf, entryDays + exit.timeExitDays - 1, calendar)
}
