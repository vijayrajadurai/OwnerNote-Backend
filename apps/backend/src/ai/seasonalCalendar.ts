import type { SeasonalEventDefinition } from "./types";

/**
 * Single source of truth for the seasonal calendar. Business category
 * personalizes which events apply — nothing about seasonal intelligence is
 * hardcoded per-category in the insight-generation logic itself, it all
 * flows from this table.
 *
 * Dates for lunar/shifting festivals (Diwali, Pongal) are approximate
 * representative dates for lead-time planning purposes, not exact
 * astronomical dates — in production this table should be refreshed yearly
 * (or moved to a DB table an admin can edit) with the actual festival
 * dates for that year.
 */
export const SEASONAL_EVENTS: SeasonalEventDefinition[] = [
  {
    id: "pongal",
    name: "Pongal",
    categories: ["TEXTILE", "GROCERY"],
    month: 1,
    day: 14,
    leadTimeDays: 30,
    note: "Pongal season — new clothes, groceries, and gifting demand typically rises.",
  },
  {
    id: "school-reopening",
    name: "School reopening",
    categories: ["TEXTILE", "STATIONERY", "FOOTWEAR"],
    month: 6,
    day: 1,
    leadTimeDays: 30,
    note: "School reopening — uniforms, stationery, and footwear demand typically rises.",
  },
  {
    id: "monsoon-vehicle-care",
    name: "Monsoon vehicle-maintenance season",
    categories: ["AUTO_PARTS"],
    month: 6,
    day: 1,
    leadTimeDays: 20,
    note: "Monsoon season — demand for wipers, brakes, and tyres typically rises.",
  },
  {
    id: "monsoon-health",
    name: "Monsoon health season",
    categories: ["PHARMACY"],
    month: 6,
    day: 15,
    leadTimeDays: 20,
    note: "Monsoon season — seasonal illness-related demand typically rises.",
  },
  {
    id: "construction-season",
    name: "Post-monsoon construction/renovation season",
    categories: ["HARDWARE", "ELECTRICAL", "FURNITURE"],
    month: 10,
    day: 1,
    leadTimeDays: 30,
    note: "Post-monsoon construction and renovation activity typically picks up.",
  },
  {
    id: "diwali",
    name: "Diwali",
    categories: ["TEXTILE", "GROCERY", "ELECTRICAL", "MOBILE_ACCESSORIES", "FURNITURE", "FOOTWEAR", "BEAUTY_SALON"],
    month: 11,
    day: 1,
    leadTimeDays: 45,
    note: "Diwali — festival and gifting demand typically rises across most product lines.",
  },
  {
    id: "wedding-season",
    name: "Wedding season",
    categories: ["TEXTILE", "FURNITURE", "ELECTRICAL", "FOOTWEAR", "BEAUTY_SALON"],
    month: 11,
    day: 15,
    leadTimeDays: 30,
    note: "Wedding season — demand for clothing, gifting, and home essentials typically rises.",
  },
  {
    id: "device-upgrade-season",
    name: "Festive device-upgrade season",
    categories: ["MOBILE_ACCESSORIES"],
    month: 10,
    day: 1,
    leadTimeDays: 30,
    note: "Festive season device-upgrade demand typically rises.",
  },
  {
    id: "year-end-celebrations",
    name: "Year-end celebration season",
    categories: ["RESTAURANT_FOOD"],
    month: 12,
    day: 15,
    leadTimeDays: 20,
    note: "Year-end celebration season — catering and dine-out demand typically rises.",
  },
];

export function isCategoryMatch(categories: string[] | "ALL", category: string): boolean {
  return categories === "ALL" || categories.includes(category);
}
