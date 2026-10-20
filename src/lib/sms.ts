// Bank SMS forwarded from the iPhone (Shortcuts automation) → a pending entry.
// Pure: no database, no clock (the caller passes the day it arrived).

import { isIsoDate } from "./dates";
import { parseMoney } from "./money";

export const messageKinds = ["purchase", "withdrawal", "bank_transfer", "other"] as const;
export type MessageKind = (typeof messageKinds)[number];

export type ParsedSms = {
  kind: MessageKind;
  merchant: string | null;
  /** In local currency (minor units); null when unreadable or charged in a foreign currency. */
  amount: number | null;
  /** Bank charge on a transfer. */
  fee: number | null;
  foreignCurrency: string | null;
  foreignAmount: number | null;
  /** Last digits of the bank account a transfer left ("2001"). */
  accountRef: string | null;
  occurredOn: string;
};

const LOCAL = new Set(["LKR", "RS", "RS."]);
const MONEY = String.raw`([\d,]+(?:\.\d{1,2})?)`;

// Not money that moved: OTPs, declined cards, and account POS debits (the card text covers those).
const IGNORE = /declined|one time password|\bOTP\b|POS trx/i;
const PURCHASE = new RegExp(String.raw`Purchase at (.+?) for ([A-Z]{3}) ${MONEY} on (\d{2})/(\d{2})/(\d{2})`, "i");
const WITHDRAWAL = new RegExp(String.raw`Withdrawal at (.+?) for ([A-Z]{3}) ${MONEY} on (\d{2})/(\d{2})/(\d{2})`, "i");
const TRANSFER = new RegExp(
  String.raw`trf of ([A-Z]{3}) ${MONEY}(?:\s*&\s*charge of ([A-Z]{3}) ${MONEY})?.*?A/C\s*\*+(\d+)`,
  "i",
);
const ANY_LOCAL = new RegExp(String.raw`(?:LKR|Rs\.?)\s*${MONEY}`, "i");

/** null → not a transaction; drop it. */
export function parseBankSms(text: string, receivedOn: string): ParsedSms | null {
  const body = text.replace(/\s+/g, " ").trim();
  if (!body || IGNORE.test(body)) return null;

  const base: ParsedSms = {
    kind: "other",
    merchant: null,
    amount: null,
    fee: null,
    foreignCurrency: null,
    foreignAmount: null,
    accountRef: null,
    occurredOn: receivedOn,
  };

  const purchase = PURCHASE.exec(body);
  const card = purchase ?? WITHDRAWAL.exec(body);
  if (card) {
    const [, place, ccy, value, dd, mm, yy] = card;
    return {
      ...base,
      kind: purchase ? "purchase" : "withdrawal",
      merchant: cleanMerchant(place),
      ...money(ccy, value),
      occurredOn: smsDate(dd, mm, yy) ?? receivedOn,
    };
  }

  const trf = TRANSFER.exec(body);
  if (trf) {
    const [, ccy, value, feeCcy, feeValue, ref] = trf;
    return {
      ...base,
      kind: "bank_transfer",
      ...money(ccy, value),
      fee: feeCcy && LOCAL.has(feeCcy.toUpperCase()) ? parseMoney(feeValue) : null,
      accountRef: ref.slice(-4),
    };
  }

  const any = ANY_LOCAL.exec(body);
  return { ...base, amount: any ? parseMoney(any[1]) : null };
}

function money(ccy: string, value: string) {
  const parsed = parseMoney(value);
  return LOCAL.has(ccy.toUpperCase())
    ? { amount: parsed, foreignCurrency: null, foreignAmount: null }
    : { amount: null, foreignCurrency: ccy.toUpperCase(), foreignAmount: parsed };
}

/** "SPICE LAND RESTURANT DEHIWALA LK" → "SPICE LAND RESTURANT DEHIWALA"; "… SG SG" → "…". */
function cleanMerchant(raw: string): string | null {
  const name = raw.replace(/\s+([A-Z]{2})(\s+\1)?$/, "").trim();
  return name || null;
}

/** dd/mm/yy → YYYY-MM-DD, or null if it isn't a real date. */
function smsDate(dd: string, mm: string, yy: string): string | null {
  const iso = `20${yy}-${mm}-${dd}`;
  return isIsoDate(iso) ? iso : null;
}
