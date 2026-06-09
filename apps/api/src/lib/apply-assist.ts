import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { buildStealthInitScript, formatRuntimeError, type AppSettings } from "@flathunter/shared";

import type { ApiEnv } from "../config";

export type ApplyAssistStatus = "idle" | "running";

export type ApplyAssistSummary = {
  listingId: number;
  status: ApplyAssistStatus;
  message: string | null;
  filledFields: string[];
  startedAt: string | null;
  updatedAt: string | null;
};

type ApplyAssistSession = {
  listingId: number;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  filledFields: string[];
  startedAt: Date;
  updatedAt: Date;
  message: string | null;
};

const applyAssistSessions = new Map<number, ApplyAssistSession>();

function serializeSummary(listingId: number, status: ApplyAssistStatus, session?: Partial<ApplyAssistSession> & { message?: string | null }): ApplyAssistSummary {
  return {
    listingId,
    status,
    message: session?.message ?? null,
    filledFields: session?.filledFields ?? [],
    startedAt: session?.startedAt?.toISOString() ?? null,
    updatedAt: session?.updatedAt?.toISOString() ?? null
  };
}

async function closeSession(session: ApplyAssistSession | undefined) {
  if (!session) {
    return;
  }

  await session.page.close().catch(() => {});
  await session.context.close().catch(() => {});
  await session.browser.close().catch(() => {});
}

/**
 * Best-effort generic contact-form pre-fill. Selectors are heuristic on
 * purpose: every housing company form differs, and a human reviews and
 * submits the form anyway. Fields that cannot be found are skipped.
 */
async function prefillContactForm(
  page: Page,
  profile: AppSettings["profile"],
  message: { subject: string | null; body: string }
): Promise<string[]> {
  const filled: string[] = [];

  const tryFill = async (label: string, selectors: string[], value: string) => {
    if (!value.trim()) {
      return;
    }

    for (const selector of selectors) {
      try {
        const locator = page.locator(selector).first();

        if ((await locator.count()) > 0 && (await locator.isVisible().catch(() => false))) {
          await locator.fill(value, { timeout: 2_000 });
          filled.push(label);
          return;
        }
      } catch {
        // Selector mismatch or non-fillable element — try the next one.
      }
    }
  };

  await tryFill("email", ['input[type="email"]', 'input[name*="mail" i]', 'input[id*="mail" i]'], profile.email);
  await tryFill(
    "name",
    ['input[name*="vorname" i]', 'input[name*="firstname" i]', 'input[name*="first-name" i]'],
    profile.fullName.split(" ")[0] ?? profile.fullName
  );
  await tryFill(
    "surname",
    ['input[name*="nachname" i]', 'input[name*="lastname" i]', 'input[name*="last-name" i]', 'input[name*="surname" i]'],
    profile.fullName.split(" ").slice(1).join(" ")
  );
  await tryFill(
    "full name",
    ['input[name="name" i]', 'input[id="name" i]', 'input[name*="fullname" i]'],
    profile.fullName
  );
  await tryFill("phone", ['input[type="tel"]', 'input[name*="phone" i]', 'input[name*="telefon" i]'], profile.phone);
  await tryFill(
    "subject",
    ['input[name*="subject" i]', 'input[name*="betreff" i]'],
    message.subject ?? ""
  );
  await tryFill("message", ["textarea"], message.body);

  return filled;
}

export async function startApplyAssist({
  listingId,
  url,
  settings,
  message,
  env
}: {
  listingId: number;
  url: string;
  settings: AppSettings;
  message: { subject: string | null; body: string };
  env: ApiEnv;
}): Promise<ApplyAssistSummary> {
  await closeSession(applyAssistSessions.get(listingId));
  applyAssistSessions.delete(listingId);

  if (!env.ENABLE_MANUAL_SOURCE_AUTH_BOOTSTRAP) {
    return serializeSummary(listingId, "idle", {
      message:
        "Form assist needs a local browser. Run the API on your local machine (same flag as the manual source login: ENABLE_MANUAL_SOURCE_AUTH_BOOTSTRAP)."
    });
  }

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    browser = await chromium.launch({ headless: false });
    context = await browser.newContext({
      locale: "de-DE",
      timezoneId: "Europe/Berlin"
    });
    await context.addInitScript(buildStealthInitScript());
    page = await context.newPage();

    const now = new Date();
    const session: ApplyAssistSession = {
      listingId,
      browser,
      context,
      page,
      filledFields: [],
      startedAt: now,
      updatedAt: now,
      message: null
    };
    applyAssistSessions.set(listingId, session);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => {});
    await page.bringToFront().catch(() => {});

    session.filledFields = await prefillContactForm(page, settings.profile, message);
    session.updatedAt = new Date();
    session.message =
      session.filledFields.length > 0
        ? `Pre-filled: ${session.filledFields.join(", ")}. Review the form in the opened window, submit it manually, then record the attempt.`
        : "No recognizable contact form on the page yet — navigate to the contact form in the opened window, paste the message, submit, then record the attempt.";

    return serializeSummary(listingId, "running", session);
  } catch (error) {
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    applyAssistSessions.delete(listingId);

    return serializeSummary(listingId, "idle", {
      message: `Unable to open the form assist browser. ${formatRuntimeError(error, "Unknown browser launch error.")}`
    });
  }
}

export async function finishApplyAssist(listingId: number): Promise<{ wasRunning: boolean }> {
  const session = applyAssistSessions.get(listingId);
  await closeSession(session);
  applyAssistSessions.delete(listingId);

  return { wasRunning: Boolean(session) };
}
