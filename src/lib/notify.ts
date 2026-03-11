const WEBHOOK_URL = process.env.NOTIFY_WEBHOOK_URL ?? "";

export type Severity = "info" | "warn" | "critical";

/**
 * Send notification via webhook (Discord/Slack compatible).
 * Falls back to console.log if no webhook is configured.
 */
export async function notify(
  severity: Severity,
  message: string,
): Promise<void> {
  const prefix = severity === "critical" ? "🚨" : severity === "warn" ? "⚠️" : "ℹ️";
  const text = `${prefix} [${severity.toUpperCase()}] ${message}`;

  console.log(text);

  if (!WEBHOOK_URL) return;

  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    });
  } catch (err) {
    console.error(`[notify] Failed to send webhook: ${err}`);
  }
}
