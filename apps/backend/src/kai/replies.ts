import { quantity, rupees, say } from "./language";
import type { HowTo, KaiLang, PartyRef, ReportPeriod } from "./types";
import type { Flows, HistoryLine, OverdueEntry, PartyBalance, StockLine, TodaySummary, Totals } from "./tools";

/** Kai's words for each answer, in the owner's language. Every number here comes from a tool result. */

const d = (date: Date) => date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
const kindWord = (lang: KaiLang, p: PartyRef) =>
  p.kind === "CUSTOMER" ? say(lang, { ta: "கஸ்டமர்", tl: "customer", en: "customer" }) : say(lang, { ta: "சப்ளையர்", tl: "supplier", en: "supplier" });

export function balanceReply(lang: KaiLang, b: PartyBalance): string {
  const n = b.party.name;
  if (b.totalEntries === 0) {
    return say(lang, {
      ta: `${n}-க்கு இன்னும் எந்த entry-யும் இல்ல.`,
      tl: `${n}-ku innum entry edhuvum illa.`,
      en: `There are no entries for ${n} yet.`,
    });
  }
  if (b.pending <= 0) {
    return b.party.kind === "CUSTOMER"
      ? say(lang, { ta: `${n} முழுசா settle பண்ணிட்டாங்க — பாக்கி இல்ல.`, tl: `${n} full-a settle pannitaanga — baaki illa.`, en: `${n} has paid everything — nothing pending.` })
      : say(lang, { ta: `${n}-க்கு நீங்க எதுவும் கொடுக்க வேண்டியது இல்ல.`, tl: `${n}-ku neenga edhuvum kudukka vendiyadhu illa.`, en: `You owe ${n} nothing right now.` });
  }
  const amount = rupees(b.pending);
  const entries = b.pendingEntries;
  let text =
    b.party.kind === "CUSTOMER"
      ? say(lang, {
          ta: `${n} உங்களுக்கு ${amount} தரணும் (${entries} entry).`,
          tl: `${n} ungalukku ${amount} tharanum (${entries} entry pending).`,
          en: `${n} owes you ${amount} (${entries} pending ${entries === 1 ? "entry" : "entries"}).`,
        })
      : say(lang, {
          ta: `நீங்க ${n}-க்கு ${amount} கொடுக்கணும் (${entries} entry).`,
          tl: `Neenga ${n}-ku ${amount} kudukanum (${entries} entry pending).`,
          en: `You owe ${n} ${amount} (${entries} pending ${entries === 1 ? "entry" : "entries"}).`,
        });
  if (b.overdue > 0) {
    text += " " + say(lang, {
      ta: `இதுல ${rupees(b.overdue)} due date தாண்டிருச்சு.`,
      tl: `Idhula ${rupees(b.overdue)} due date thaandiruchu.`,
      en: `${rupees(b.overdue)} of it is past the due date.`,
    });
  } else if (b.nextDue) {
    text += " " + say(lang, { ta: `அடுத்த due: ${d(b.nextDue)}.`, tl: `Adutha due: ${d(b.nextDue)}.`, en: `Next due: ${d(b.nextDue)}.` });
  }
  return text;
}

export function claimReply(lang: KaiLang, claimed: number, pending: number): string {
  if (Math.abs(claimed - pending) < 0.005) {
    return say(lang, { ta: "Records-உம் அதையே சொல்லுது ✓", tl: "Records-um adhe thaan solludhu ✓", en: "That matches your records ✓" });
  }
  return say(lang, {
    ta: `நீங்க சொன்ன ${rupees(claimed)} records-ஓட match ஆகல; records-ல ${rupees(pending)} தான் இருக்கு. Entry ஏதாவது miss ஆகியிருந்தா சொல்லுங்க, add பண்ணலாம்.`,
    tl: `Neenga sonna ${rupees(claimed)} records-oda match aagala; records-la ${rupees(pending)} thaan irukku. Entry edhavadhu miss aagi irundha sollunga, add pannalaam.`,
    en: `You said ${rupees(claimed)}, but your records show ${rupees(pending)}. If an entry is missing, tell me and I'll add it.`,
  });
}

export function choiceReply(lang: KaiLang, said: string, options: PartyRef[]): string {
  const list = options.map((o, i) => `${i + 1}. ${o.name} (${kindWord(lang, o)})`).join("\n");
  return say(lang, {
    ta: `"${said}"-னு ${options.length} பேர் இருக்காங்க — யாரு?\n${list}`,
    tl: `"${said}"-nu ${options.length} peru irukkaanga — yaaru?\n${list}`,
    en: `I have ${options.length} people matching "${said}" — which one?\n${list}`,
  });
}

export function unknownPartyReply(lang: KaiLang, said: string): string {
  return say(lang, {
    ta: `"${said}"-னு யாரும் உங்க records-ல இல்ல. பேர் சரியா-னு பாருங்க.`,
    tl: `"${said}"-nu yaarum unga records-la illa. Peru sari-yaa-nu paarunga.`,
    en: `I can't find anyone called "${said}" in your records. Please check the name.`,
  });
}

export function totalReceivableReply(lang: KaiLang, t: Totals): string {
  if (t.receivable <= 0) return say(lang, { ta: "இப்போ யாரும் உங்களுக்கு பாக்கி தர வேண்டியது இல்ல.", tl: "Ippo yaarum ungalukku baaki thara vendiyadhu illa.", en: "No customer owes you anything right now." });
  const top = t.topReceivable.slice(0, 3).map((e) => `${e.name} ${rupees(e.amount)}`).join(", ");
  return say(lang, {
    ta: `மொத்தம் ${rupees(t.receivable)} வரணும் — ${t.receivableParties} கஸ்டமர் கிட்ட. அதிகமா: ${top}.`,
    tl: `Motham ${rupees(t.receivable)} varanum — ${t.receivableParties} customers kitta. Adhigama: ${top}.`,
    en: `Customers owe you ${rupees(t.receivable)} in total (${t.receivableParties} customers). Largest: ${top}.`,
  });
}

export function totalPayableReply(lang: KaiLang, t: Totals): string {
  if (t.payable <= 0) return say(lang, { ta: "எந்த சப்ளையருக்கும் நீங்க கொடுக்க வேண்டியது இல்ல.", tl: "Endha supplier-kum neenga kudukka vendiyadhu illa.", en: "You don't owe any supplier right now." });
  const top = t.topPayable.slice(0, 3).map((e) => `${e.name} ${rupees(e.amount)}`).join(", ");
  return say(lang, {
    ta: `சப்ளையர்களுக்கு மொத்தம் ${rupees(t.payable)} கொடுக்கணும் (${t.payableParties} பேர்). அதிகமா: ${top}.`,
    tl: `Suppliers-ku motham ${rupees(t.payable)} kudukanum (${t.payableParties} peru). Adhigama: ${top}.`,
    en: `You owe suppliers ${rupees(t.payable)} in total (${t.payableParties} suppliers). Largest: ${top}.`,
  });
}

export function overdueReply(lang: KaiLang, list: OverdueEntry[]): string {
  if (list.length === 0) return say(lang, { ta: "Due date தாண்டின பாக்கி எதுவும் இல்ல 👍", tl: "Due date thaandina baaki edhuvum illa 👍", en: "Nothing is overdue 👍" });
  const lines = list.slice(0, 5).map((e, i) => `${i + 1}. ${e.name} — ${rupees(e.amount)} (${e.daysLate} ${say(lang, { ta: "நாள்", tl: "naal", en: e.daysLate === 1 ? "day" : "days" })})`);
  const total = rupees(list.reduce((s, e) => s + e.amount, 0));
  return say(lang, {
    ta: `Due தாண்டினது மொத்தம் ${total}. முதல்ல இவங்க கிட்ட வாங்குங்க:\n${lines.join("\n")}`,
    tl: `Due thaandinadhu motham ${total}. Mudhalla ivanga kitta vaangunga:\n${lines.join("\n")}`,
    en: `${total} is overdue. Collect from these first:\n${lines.join("\n")}`,
  });
}

export function todayReply(lang: KaiLang, t: TodaySummary): string {
  return say(lang, {
    ta: `இன்னைக்கு: கடன் கொடுத்தது ${rupees(t.creditGiven)} (${t.creditEntries} entry), வசூல் ${rupees(t.collected)} (${t.collections} payment), வாங்கினது ${rupees(t.purchases)}, சப்ளையருக்கு கொடுத்தது ${rupees(t.paidToSuppliers)}.`,
    tl: `Inniku: credit kuduthadhu ${rupees(t.creditGiven)} (${t.creditEntries} entry), vasool ${rupees(t.collected)} (${t.collections} payment), purchase ${rupees(t.purchases)}, suppliers-ku kuduthadhu ${rupees(t.paidToSuppliers)}.`,
    en: `Today: credit given ${rupees(t.creditGiven)} (${t.creditEntries} entries), collected ${rupees(t.collected)} (${t.collections} payments), purchases ${rupees(t.purchases)}, paid to suppliers ${rupees(t.paidToSuppliers)}.`,
  });
}

export function stockReply(lang: KaiLang, s: StockLine): string {
  const qty = `${quantity(s.currentStock)} ${s.unit}`;
  let text = say(lang, { ta: `${s.name}: ${qty} இருக்கு.`, tl: `${s.name}: ${qty} irukku.`, en: `${s.name}: ${qty} in stock.` });
  if (s.currentStock <= s.minimumStock) {
    text += " " + say(lang, {
      ta: `Minimum ${quantity(s.minimumStock)} — reorder பண்ணுங்க.`,
      tl: `Minimum ${quantity(s.minimumStock)} — reorder pannunga.`,
      en: `That's at or below the minimum of ${quantity(s.minimumStock)} — time to reorder.`,
    });
  }
  return text;
}

export function lowStockReply(lang: KaiLang, list: StockLine[]): string {
  if (list.length === 0) return say(lang, { ta: "எல்லா stock-உம் minimum-க்கு மேல இருக்கு 👍", tl: "Ella stock-um minimum-ku mela irukku 👍", en: "Everything is above its minimum stock 👍" });
  const lines = list.slice(0, 8).map((s) => `• ${s.name}: ${quantity(s.currentStock)} ${s.unit} (min ${quantity(s.minimumStock)})`);
  const more = list.length > 8 ? say(lang, { ta: `\n…இன்னும் ${list.length - 8}`, tl: `\n…innum ${list.length - 8}`, en: `\n…and ${list.length - 8} more` }) : "";
  return say(lang, { ta: `கம்மியா இருக்கு (${list.length}):\n`, tl: `Kammiya irukku (${list.length}):\n`, en: `Running low (${list.length}):\n` }) + lines.join("\n") + more;
}

export function cashFlowReply(lang: KaiLang, w: { expectedCollections: number; expectedPayments: number; potentialGap: number }): string {
  const gap =
    w.potentialGap > 0
      ? say(lang, { ta: ` ${rupees(w.potentialGap)} குறையலாம் (estimate).`, tl: ` ${rupees(w.potentialGap)} gap varalaam (estimate).`, en: ` A possible gap of ${rupees(w.potentialGap)} (estimate).` })
      : say(lang, { ta: " வர்றது கொடுக்கறதை cover பண்ணும்.", tl: " Varradhu kudukkradha cover pannum.", en: " Expected collections cover expected payments." });
  return (
    say(lang, {
      ta: `அடுத்த 7 நாள்: வர வேண்டியது ${rupees(w.expectedCollections)}, கொடுக்க வேண்டியது ${rupees(w.expectedPayments)}.`,
      tl: `Adutha 7 naal: vara vendiyadhu ${rupees(w.expectedCollections)}, kudukka vendiyadhu ${rupees(w.expectedPayments)}.`,
      en: `Next 7 days: expected collections ${rupees(w.expectedCollections)}, expected payments ${rupees(w.expectedPayments)}.`,
    }) + gap
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Reports and "how to"


export function periodName(lang: KaiLang, p: ReportPeriod): string {
  const names: Record<ReportPeriod, { ta: string; tl: string; en: string }> = {
    TODAY: { ta: "இன்னைக்கு", tl: "Inniku", en: "Today" },
    YESTERDAY: { ta: "நேத்து", tl: "Nethu", en: "Yesterday" },
    THIS_WEEK: { ta: "இந்த வாரம்", tl: "Indha vaaram", en: "This week" },
    LAST_WEEK: { ta: "போன வாரம்", tl: "Pona vaaram", en: "Last week" },
    LAST_7_DAYS: { ta: "கடந்த 7 நாள்", tl: "Kadandha 7 naal", en: "Last 7 days" },
    THIS_MONTH: { ta: "இந்த மாசம்", tl: "Indha maasam", en: "This month" },
    LAST_MONTH: { ta: "போன மாசம்", tl: "Pona maasam", en: "Last month" },
    ALL: { ta: "மொத்தம்", tl: "Motham", en: "All time" },
  };
  return say(lang, names[p]);
}

export function collectionsReply(lang: KaiLang, p: ReportPeriod, f: Flows): string {
  const when = periodName(lang, p);
  if (f.collections === 0) return say(lang, { ta: `${when}: வசூல் எதுவும் வரல.`, tl: `${when}: vasool edhuvum varala.`, en: `${when}: no payments received.` });
  const top = f.topPayers.map((e) => `${e.name} ${rupees(e.amount)}`).join(", ");
  return say(lang, {
    ta: `${when} வசூல்: ${rupees(f.collected)} (${f.collections} payment). அதிகமா: ${top}.`,
    tl: `${when} vasool: ${rupees(f.collected)} (${f.collections} payment). Adhigama: ${top}.`,
    en: `${when}: ${rupees(f.collected)} received (${f.collections} payments). Largest: ${top}.`,
  });
}

export function paymentsMadeReply(lang: KaiLang, p: ReportPeriod, f: Flows): string {
  const when = periodName(lang, p);
  return say(lang, {
    ta: `${when} சப்ளையர்களுக்கு கொடுத்தது: ${rupees(f.paidOut)} (${f.paymentsOut} payment).`,
    tl: `${when} suppliers-ku kuduthadhu: ${rupees(f.paidOut)} (${f.paymentsOut} payment).`,
    en: `${when}: ${rupees(f.paidOut)} paid to suppliers (${f.paymentsOut} payments).`,
  });
}

export function purchasesReply(lang: KaiLang, p: ReportPeriod, f: Flows): string {
  const when = periodName(lang, p);
  return say(lang, {
    ta: `${when} purchase (கடனுக்கு): ${rupees(f.purchases)} (${f.purchaseEntries} entry).`,
    tl: `${when} purchase (credit-la): ${rupees(f.purchases)} (${f.purchaseEntries} entry).`,
    en: `${when}: purchases on credit ${rupees(f.purchases)} (${f.purchaseEntries} entries).`,
  });
}

export function salesReply(lang: KaiLang, p: ReportPeriod, f: Flows, cash: { reports: number; totalIn: number }): string {
  const when = periodName(lang, p);
  const credit = say(lang, {
    ta: `${when} கடன் விற்பனை: ${rupees(f.creditGiven)} (${f.creditEntries} entry).`,
    tl: `${when} credit sales: ${rupees(f.creditGiven)} (${f.creditEntries} entry).`,
    en: `${when}: credit sales ${rupees(f.creditGiven)} (${f.creditEntries} entries).`,
  });
  const cashLine =
    cash.reports > 0
      ? say(lang, { ta: ` Daily Cash IN: ${rupees(cash.totalIn)}.`, tl: ` Daily Cash IN: ${rupees(cash.totalIn)}.`, en: ` Daily Cash IN: ${rupees(cash.totalIn)}.` })
      : say(lang, {
          ta: " Cash விற்பனை-க்கு இந்த நாட்கள்ல Daily Cash report இல்ல.",
          tl: " Cash sales-ku indha naatkala Daily Cash report illa.",
          en: " There's no Daily Cash report for these days, so cash sales aren't known.",
        });
  return credit + cashLine;
}

export function expensesReply(lang: KaiLang, p: ReportPeriod, cash: { reports: number; totalOut: number }): string {
  const when = periodName(lang, p);
  if (cash.reports === 0) {
    return say(lang, {
      ta: `${when}-க்கு Daily Cash report இல்ல — செலவு கணக்கு தெரியாது. Daily Cash-ல OUT-ஆ போடுங்க.`,
      tl: `${when}-ku Daily Cash report illa — expense kanakku theriyaadhu. Daily Cash-la OUT-a podunga.`,
      en: `${when}: there's no Daily Cash report, so I don't know your expenses. Add them as OUT in Daily Cash.`,
    });
  }
  return say(lang, {
    ta: `${when} Daily Cash OUT (செலவு உட்பட): ${rupees(cash.totalOut)} (${cash.reports} நாள் report).`,
    tl: `${when} Daily Cash OUT (expense ellam serthu): ${rupees(cash.totalOut)} (${cash.reports} naal report).`,
    en: `${when}: Daily Cash OUT (expenses included) ${rupees(cash.totalOut)} (${cash.reports} daily reports).`,
  });
}

export function profitReply(lang: KaiLang, p: ReportPeriod, loss: boolean, f: Flows, cash: { reports: number; totalIn: number; totalOut: number }): string {
  const when = periodName(lang, p);
  const what = loss ? say(lang, { ta: "நஷ்டம்", tl: "Loss", en: "Loss" }) : say(lang, { ta: "லாபம்", tl: "Profit", en: "Profit" });
  const known = say(lang, {
    ta: `${when}: கடன் விற்பனை ${rupees(f.creditGiven)}, purchase ${rupees(f.purchases)}${cash.reports ? `, Daily Cash IN ${rupees(cash.totalIn)} / OUT ${rupees(cash.totalOut)}` : ""}.`,
    tl: `${when}: credit sales ${rupees(f.creditGiven)}, purchase ${rupees(f.purchases)}${cash.reports ? `, Daily Cash IN ${rupees(cash.totalIn)} / OUT ${rupees(cash.totalOut)}` : ""}.`,
    en: `${when}: credit sales ${rupees(f.creditGiven)}, purchases ${rupees(f.purchases)}${cash.reports ? `, Daily Cash IN ${rupees(cash.totalIn)} / OUT ${rupees(cash.totalOut)}` : ""}.`,
  });
  return (
    say(lang, {
      ta: `${what} கணக்கு போட பொருள் விலை (cost) & செலவு data முழுசா இல்ல — நான் guess பண்ண மாட்டேன். `,
      tl: `${what} kanakku poda porul cost & expense data muzhusa illa — naan guess panna maatten. `,
      en: `${what} needs cost-of-goods and expense data that Owner Note doesn't fully have, so I won't guess it. `,
    }) + known
  );
}

export function cashReply(lang: KaiLang, latest: { date: string; closing: number; cashIn: number; cashOut: number } | null): string {
  if (!latest) {
    return say(lang, {
      ta: "Daily Cash report இன்னும் submit பண்ணல — கல்லாப்பெட்டி balance தெரியாது.",
      tl: "Daily Cash report innum submit pannala — kallapetti balance theriyaadhu.",
      en: "No Daily Cash report has been submitted yet, so I don't know the cash balance.",
    });
  }
  return say(lang, {
    ta: `கடைசி Daily Cash report (${latest.date}): closing balance ${rupees(latest.closing)} (cash IN ${rupees(latest.cashIn)}, OUT ${rupees(latest.cashOut)}).`,
    tl: `Kadaisi Daily Cash report (${latest.date}): closing balance ${rupees(latest.closing)} (cash IN ${rupees(latest.cashIn)}, OUT ${rupees(latest.cashOut)}).`,
    en: `Latest Daily Cash report (${latest.date}): closing balance ${rupees(latest.closing)} (cash in ${rupees(latest.cashIn)}, out ${rupees(latest.cashOut)}).`,
  });
}

export function historyReply(lang: KaiLang, p: ReportPeriod, lines: HistoryLine[]): string {
  const when = periodName(lang, p);
  if (lines.length === 0) return say(lang, { ta: `${when}: entry எதுவும் இல்ல.`, tl: `${when}: entry edhuvum illa.`, en: `${when}: no entries.` });
  const kind = (k: HistoryLine["kind"]) =>
    ({
      CREDIT: say(lang, { ta: "கடன்", tl: "credit", en: "credit" }),
      PURCHASE: say(lang, { ta: "purchase", tl: "purchase", en: "purchase" }),
      PAYMENT_IN: say(lang, { ta: "வந்தது", tl: "vandhadhu", en: "received" }),
      PAYMENT_OUT: say(lang, { ta: "கொடுத்தது", tl: "kuduthadhu", en: "paid" }),
    })[k];
  const rows = lines.map((l) => `• ${d(l.at)} — ${l.name}: ${kind(l.kind)} ${rupees(l.amount)}`);
  return say(lang, { ta: `${when} entries:\n`, tl: `${when} entries:\n`, en: `${when} — latest entries:\n` }) + rows.join("\n");
}

export function partiesReply(lang: KaiLang, suppliers: boolean, c: { customers: number; suppliers: number; totals: Totals }): string {
  if (suppliers) {
    const top = c.totals.topPayable.slice(0, 3).map((e) => `${e.name} ${rupees(e.amount)}`).join(", ");
    return say(lang, {
      ta: `${c.suppliers} சப்ளையர்; ${c.totals.payableParties} பேருக்கு கொடுக்கணும்${top ? ` — ${top}` : ""}.`,
      tl: `${c.suppliers} suppliers; ${c.totals.payableParties} peru-ku kudukanum${top ? ` — ${top}` : ""}.`,
      en: `${c.suppliers} suppliers; you owe ${c.totals.payableParties} of them${top ? ` — ${top}` : ""}.`,
    });
  }
  const top = c.totals.topReceivable.slice(0, 3).map((e) => `${e.name} ${rupees(e.amount)}`).join(", ");
  return say(lang, {
    ta: `${c.customers} கஸ்டமர்; ${c.totals.receivableParties} பேர் பாக்கி தரணும்${top ? ` — ${top}` : ""}.`,
    tl: `${c.customers} customers; ${c.totals.receivableParties} peru baaki tharanum${top ? ` — ${top}` : ""}.`,
    en: `${c.customers} customers; ${c.totals.receivableParties} of them owe you${top ? ` — ${top}` : ""}.`,
  });
}

export function stockSummaryReply(lang: KaiLang, s: { products: number; low: number; out: number; lowest: Pick<StockLine, "name" | "unit" | "currentStock">[] }): string {
  if (s.products === 0) return say(lang, { ta: "Inventory-ல product எதுவும் இல்ல.", tl: "Inventory-la product edhuvum illa.", en: "There are no products in your inventory yet." });
  const low = s.lowest.map((p) => `${p.name} ${quantity(p.currentStock)} ${p.unit}`).join(", ");
  return say(lang, {
    ta: `${s.products} product; ${s.low} கம்மியா, ${s.out} stock இல்ல${low ? ` — ${low}` : ""}.`,
    tl: `${s.products} products; ${s.low} kammiya, ${s.out} stock illa${low ? ` — ${low}` : ""}.`,
    en: `${s.products} products; ${s.low} running low, ${s.out} out of stock${low ? ` — ${low}` : ""}.`,
  });
}

export function summaryReply(lang: KaiLang, p: ReportPeriod, f: Flows, t: Totals): string {
  const when = periodName(lang, p);
  return say(lang, {
    ta: `${when}: கடன் கொடுத்தது ${rupees(f.creditGiven)}, வசூல் ${rupees(f.collected)}, purchase ${rupees(f.purchases)}, சப்ளையருக்கு கொடுத்தது ${rupees(f.paidOut)}. இப்போ வரணும் ${rupees(t.receivable)}, கொடுக்கணும் ${rupees(t.payable)}.`,
    tl: `${when}: credit kuduthadhu ${rupees(f.creditGiven)}, vasool ${rupees(f.collected)}, purchase ${rupees(f.purchases)}, suppliers-ku kuduthadhu ${rupees(f.paidOut)}. Ippo varanum ${rupees(t.receivable)}, kudukanum ${rupees(t.payable)}.`,
    en: `${when}: credit given ${rupees(f.creditGiven)}, collected ${rupees(f.collected)}, purchases ${rupees(f.purchases)}, paid to suppliers ${rupees(f.paidOut)}. Now receivable ${rupees(t.receivable)}, payable ${rupees(t.payable)}.`,
  });
}

export function pendingReply(lang: KaiLang, t: Totals): string {
  return say(lang, {
    ta: `பாக்கி: கஸ்டமர்கள் தரணும் ${rupees(t.receivable)} (${t.receivableParties} பேர்); நீங்க சப்ளையர்களுக்கு கொடுக்கணும் ${rupees(t.payable)} (${t.payableParties} பேர்).`,
    tl: `Pending: customers tharanum ${rupees(t.receivable)} (${t.receivableParties} peru); neenga suppliers-ku kudukanum ${rupees(t.payable)} (${t.payableParties} peru).`,
    en: `Pending: customers owe you ${rupees(t.receivable)} (${t.receivableParties}); you owe suppliers ${rupees(t.payable)} (${t.payableParties}).`,
  });
}

export function howToReply(lang: KaiLang, h: HowTo): string {
  const lines: Record<HowTo, { ta: string; tl: string; en: string }> = {
    SALE: {
      ta: "Cash விற்பனையை Daily Cash screen-ல போடுங்க. கடன் விற்பனை-னா சொல்லுங்க: \"குமாருக்கு 500 கடன்\" — draft பண்ணி Confirm-க்கு காட்டுவேன்.",
      tl: "Cash sale-a Daily Cash screen-la podunga. Credit sale-na sollunga: \"Kumar-ku 500 credit\" — draft panni Confirm-ku kaattuven.",
      en: "Add cash sales in the Daily Cash screen. For a credit sale, tell me \"Add 500 credit to Kumar\" and I'll draft it for you to confirm.",
    },
    EXPENSE: {
      ta: "செலவை Daily Cash screen-ல OUT-ஆ போடுங்க — Kai chat-ல இருந்து expense entry போட மாட்டேன்.",
      tl: "Expense-a Daily Cash screen-la OUT-a podunga — Kai chat-la irundhu expense entry poda maatten.",
      en: "Add expenses as OUT in the Daily Cash screen — I don't record expenses from chat.",
    },
    PURCHASE: {
      ta: "கடனுக்கு வாங்கினா சப்ளையர் பேரும் amount-உம் சொல்லுங்க: \"ரவி டிரேடர்ஸ் கிட்ட 3000-க்கு சாமான் வாங்கினேன்\". Cash-ல வாங்கினா Daily Cash-ல OUT-ஆ போடுங்க.",
      tl: "Credit-la vaanguneenga-na supplier peru + amount sollunga: \"Ravi Traders kitta 3000 ku saamaan vaanginen\". Cash-la vaanguneenga-na Daily Cash-la OUT-a podunga.",
      en: "Bought on credit? Tell me the supplier and the amount: \"Ravi Traders kitta 3000 ku saamaan vaanginen\". Paid cash? Add it as OUT in Daily Cash.",
    },
    CUSTOMER: {
      ta: "புது கஸ்டமர் பேரோட முதல் entry சொல்லுங்க: \"சுரேஷுக்கு 500 கடன்\" — Confirm பண்ணா கஸ்டமரும் சேரும்.",
      tl: "Pudhu customer peru-oda first entry sollunga: \"Suresh-ku 500 credit\" — Confirm panna customer-um serum.",
      en: "Tell me the new customer's first entry, e.g. \"Add 500 credit to Suresh\" — confirming it adds the customer too.",
    },
    SUPPLIER: {
      ta: "புது சப்ளையர் பேரோட முதல் purchase சொல்லுங்க: \"பாலு டிரேடர்ஸ் கிட்ட 2000-க்கு சாமான் வாங்கினேன்\".",
      tl: "Pudhu supplier peru-oda first purchase sollunga: \"Balu Traders kitta 2000 ku saamaan vaanginen\".",
      en: "Tell me the new supplier's first purchase, e.g. \"Balu Traders kitta 2000 ku saamaan vaanginen\" — confirming it adds the supplier.",
    },
    STOCK: {
      ta: "Stock add / குறைக்க Inventory screen-ல பண்ணுங்க. நான் stock எவ்வளவு-னு சொல்லுவேன்.",
      tl: "Stock add / minus Inventory screen-la pannunga. Naan stock evlo-nu solluven.",
      en: "Add or remove stock in the Inventory screen. I can tell you how much is in stock.",
    },
    EDIT: {
      ta: "Kai entries-ஐ edit பண்ணாது — app-ல அந்த entry-ஐ open பண்ணி மாத்துங்க.",
      tl: "Kai entries-a edit pannaadhu — app-la andha entry-a open panni maathunga.",
      en: "I don't edit entries from chat — open the entry in the app to change it.",
    },
    DELETE: {
      ta: "Kai entries-ஐ delete பண்ணாது — app-ல அந்த entry-ஐ open பண்ணி delete பண்ணுங்க.",
      tl: "Kai entries-a delete pannaadhu — app-la andha entry-a open panni delete pannunga.",
      en: "I don't delete entries from chat — open the entry in the app to delete it.",
    },
    UNSUPPORTED: {
      ta: "இது (invoice, receipt, tax report, Excel export, bank, discount மாதிரி) இப்போ Owner Note-ல இல்ல. நான் சொல்ல முடியறது: பாக்கி, வசூல், purchase, stock, cash.",
      tl: "Idhu (invoice, receipt, tax report, Excel export, bank, discount maadhiri) ippo Owner Note-la illa. Naan solla mudiyardhu: baaki, vasool, purchase, stock, cash.",
      en: "That (invoices, receipts, tax reports, Excel export, bank, discounts…) isn't in Owner Note yet. I can tell you balances, collections, purchases, stock and cash.",
    },
  };
  return say(lang, lines[h]);
}
