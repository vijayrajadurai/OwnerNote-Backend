import { prisma } from "../db/prisma";
import { NotFoundError } from "../utils/errors";
import { SEASONAL_EVENTS, isCategoryMatch } from "./seasonalCalendar";
import { getHistoricalWindowTotal } from "./historicalIntelligence";
import type { SeasonalInsightItem } from "./types";

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

function nextOccurrence(month: number, day: number, now: Date): Date {
  let date = new Date(now.getFullYear(), month - 1, day);
  if (daysBetween(now, date) < 0) {
    date = new Date(now.getFullYear() + 1, month - 1, day);
  }
  return date;
}

/**
 * Upcoming seasonal preparation windows relevant to this business's
 * category, each paired with a real historical estimate when one exists
 * (see historicalIntelligence.getHistoricalWindowTotal) — never a fabricated
 * number.
 */
export async function getSeasonalInsights(businessId: string, now: Date = new Date()): Promise<SeasonalInsightItem[]> {
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) throw new NotFoundError("Business not found");

  const relevantEvents = SEASONAL_EVENTS.filter((event) => isCategoryMatch(event.categories, business.category));

  const results: SeasonalInsightItem[] = [];

  for (const event of relevantEvents) {
    const eventDate = nextOccurrence(event.month, event.day, now);
    const daysAway = daysBetween(now, eventDate);
    if (daysAway < 0 || daysAway > event.leadTimeDays) continue;

    const lastYearEventDate = new Date(eventDate);
    lastYearEventDate.setFullYear(lastYearEventDate.getFullYear() - 1);
    const windowStart = new Date(lastYearEventDate);
    windowStart.setDate(windowStart.getDate() - event.leadTimeDays);

    const historical = await getHistoricalWindowTotal(businessId, windowStart, lastYearEventDate);

    results.push({
      eventId: event.id,
      eventName: event.name,
      eventDate: eventDate.toISOString(),
      daysAway,
      note: event.note,
      estimate: {
        hasHistoricalBasis: historical.hasData,
        message: historical.message,
        lastYearAmount: historical.previousPeriodTotal,
      },
    });
  }

  return results.sort((a, b) => a.daysAway - b.daysAway);
}
