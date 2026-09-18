import type { Business, BusinessCategory, DiscoverItemType } from "@prisma/client";

interface SeedTemplate {
  type: DiscoverItemType;
  title: string;
  summary: string;
  detail?: string;
  priceLabel?: string;
  daysValid?: number;
  sortOrder: number;
}

const CATEGORY_PRODUCTS: Record<BusinessCategory, string[]> = {
  TEXTILE: ["Cotton sarees", "Kids wear sets", "Premium bedsheets"],
  GROCERY: ["Basmati rice 5kg", "Cooking oil combo", "Fresh spices pack"],
  HARDWARE: ["PVC pipes", "Door locks", "Paint buckets"],
  ELECTRICAL: ["LED bulbs pack", "Extension boards", "Ceiling fans"],
  MOBILE_ACCESSORIES: ["Fast chargers", "Earbuds", "Phone covers"],
  AUTO_PARTS: ["Engine oil", "Brake pads", "Bike mirrors"],
  FURNITURE: ["Office chairs", "Study tables", "Mattresses"],
  FOOTWEAR: ["School shoes", "Sports sandals", "Leather slippers"],
  PHARMACY: ["Vitamin supplements", "First-aid kits", "Ayurvedic oils"],
  STATIONERY: ["Notebook bundles", "Pen sets", "Exam pads"],
  RESTAURANT_FOOD: ["Family meal box", "South Indian combo", "Biryani bucket"],
  BEAUTY_SALON: ["Hair spa kit", "Bridal makeup pack", "Grooming combo"],
  OTHER: ["Bestseller item A", "New arrival B", "Customer favourite C"],
};

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

export function buildDiscoverSeedTemplates(business: Business): SeedTemplate[] {
  const shop = business.businessName;
  const city = business.city;
  const products = CATEGORY_PRODUCTS[business.category];

  return [
    {
      type: "PRODUCT",
      title: `${products[0]} now in stock`,
      summary: `${shop} has fresh ${products[0].toLowerCase()} available for walk-in and phone orders.`,
      detail: `Tell regular customers that ${products[0]} is back on the shelf. Good time to post on WhatsApp status.`,
      priceLabel: "Ask in shop",
      sortOrder: 1,
    },
    {
      type: "PRODUCT",
      title: `New arrival: ${products[1]}`,
      summary: `Just received ${products[1]} — limited quantity this week at ${shop}.`,
      detail: "Highlight this as a new product on your counter display.",
      priceLabel: "New stock",
      sortOrder: 2,
    },
    {
      type: "PRODUCT",
      title: `Bestseller: ${products[2]}`,
      summary: `${products[2]} is moving fast. Restock reminder for ${shop}.`,
      detail: "Customers are asking for this item — keep it visible near billing.",
      priceLabel: "Popular",
      sortOrder: 3,
    },
    {
      type: "OFFER",
      title: "Weekend special — 10% off",
      summary: `Run a weekend discount at ${shop} on select items to boost footfall.`,
      detail: "Works well Fri–Sun. Mention the offer when customers call for price.",
      priceLabel: "10% off",
      daysValid: 7,
      sortOrder: 4,
    },
    {
      type: "OFFER",
      title: "Bulk purchase deal",
      summary: "Offer a better rate when customers buy 3+ units of the same product.",
      detail: `Encourage wholesalers and repeat buyers in ${city}.`,
      priceLabel: "Bulk rate",
      daysValid: 14,
      sortOrder: 5,
    },
    {
      type: "OFFER",
      title: "Festival combo pack",
      summary: `Bundle 2–3 fast-moving items as a festival combo at ${shop}.`,
      detail: "Seasonal combos increase average bill value without heavy discounting.",
      priceLabel: "Combo price",
      daysValid: 21,
      sortOrder: 6,
    },
    {
      type: "EVENT",
      title: "Shop anniversary week",
      summary: `${shop} celebrates another year in ${city} — plan a small in-store event.`,
      detail: "Invite top customers, offer a free snack or small gift with purchase.",
      daysValid: 10,
      sortOrder: 7,
    },
    {
      type: "EVENT",
      title: "Evening customer meet-up",
      summary: "Host a short evening gathering for loyal customers and neighbours.",
      detail: "15–20 minutes of introductions, new product demo, and Q&A.",
      daysValid: 5,
      sortOrder: 8,
    },
    {
      type: "CELEBRATION",
      title: `${shop} milestone celebration`,
      summary: `Mark a business milestone — 1000th customer or monthly sales target at ${shop}.`,
      detail: "Share the achievement on WhatsApp and thank customers publicly.",
      sortOrder: 9,
    },
    {
      type: "CELEBRATION",
      title: "Customer appreciation day",
      summary: "Dedicate one day to thank regular buyers with a small token or sweet.",
      detail: "Simple gesture builds loyalty more than a deep discount.",
      sortOrder: 10,
    },
    {
      type: "PRODUCT",
      title: "Seasonal collection highlight",
      summary: `Rotate seasonal products to the front of ${shop} for the next two weeks.`,
      detail: "Seasonal visibility lifts sales without changing prices.",
      priceLabel: "Seasonal",
      sortOrder: 11,
    },
    {
      type: "OFFER",
      title: "Credit customer loyalty benefit",
      summary: "Offer a small benefit to customers who clear dues on time this month.",
      detail: "Pairs well with Owner Note collection reminders.",
      priceLabel: "Loyalty perk",
      daysValid: 30,
      sortOrder: 12,
    },
  ];
}

export function seedTemplateToCreateData(businessId: string, template: SeedTemplate) {
  return {
    businessId,
    type: template.type,
    title: template.title,
    summary: template.summary,
    detail: template.detail ?? null,
    priceLabel: template.priceLabel ?? null,
    validUntil: template.daysValid != null ? daysFromNow(template.daysValid) : null,
    sortOrder: template.sortOrder,
    isActive: true,
  };
}
