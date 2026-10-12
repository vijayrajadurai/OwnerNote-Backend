import { quantity, rupees, say } from "./language";
import type { KaiLang, PartyRef } from "./types";
import type { OverdueEntry, PartyBalance, StockLine, TodaySummary, Totals } from "./tools";

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
