import "server-only";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { toUserMessage } from "@/lib/errors";
import { getDb, type Db } from "@/db";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Every Server Action goes through here: session check, Zod validation, one
 * place that turns expected failures into messages, and a revalidate.
 */
export async function runAction<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  fn: (db: Db, data: z.infer<S>) => Promise<T>,
): Promise<ActionResult<T>> {
  await requireSession();
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  try {
    const data = await fn(await getDb(), parsed.data);
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    unstable_rethrow(e);
    const message = toUserMessage(e);
    if (message) return { ok: false, error: message };
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
