/** An error whose message is safe and useful to show the user. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

type PgLike = { code?: string; message?: string; constraint?: string; cause?: unknown };

function pgCause(e: unknown): PgLike | null {
  let cur = e as PgLike | undefined;
  for (let i = 0; cur && i < 4; i++) {
    if (typeof cur.code === "string" || cur.message?.includes("MONTH_CLOSED")) return cur;
    cur = cur.cause as PgLike | undefined;
  }
  return null;
}

/** Turn database errors we expect into readable messages. */
export function toUserMessage(e: unknown): string | null {
  if (e instanceof UserError) return e.message;
  const pg = pgCause(e);
  if (!pg) return null;
  if (pg.message?.includes("MONTH_CLOSED")) {
    const ym = pg.message.match(/\d{4}-\d{2}/)?.[0];
    return `${ym ?? "That month"} is closed and read-only. Log late expenses in the current month.`;
  }
  if (pg.code === "23505") return "That name is already taken.";
  if (pg.code === "23503") return "That record is still in use.";
  if (pg.code === "23514") return "Some values are out of range.";
  return null;
}
