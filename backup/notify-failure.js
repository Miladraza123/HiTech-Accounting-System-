"use strict";

/**
 * Sends an alert when the Daily Backup job fails.
 *
 * Why this exists: the backup ran four times between 12 and 15 September
 * 2026 and failed every single time, and nobody found out. The only signal
 * a failure produced was the ABSENCE of the success email — which is
 * exactly the kind of signal people stop noticing. This turns a silent
 * failure into a message that arrives.
 *
 * Deliberately exits 0 in every case. The job has already failed by the
 * time this runs; if this script threw as well, the logs would show a
 * second, unrelated error on top of the real one and make the actual cause
 * harder to find.
 *
 * Honest limitation, stated rather than hidden: this emails through the
 * same Gmail secrets the backup itself uses. If THOSE are the secrets that
 * are missing or wrong, no alert can be sent — the script says so in the
 * job log instead. So the first run after configuring the secrets still has
 * to be checked by hand.
 */

const nodemailer = require("nodemailer");

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const BACKUP_TO_EMAIL = process.env.BACKUP_TO_EMAIL;
const RUN_URL = process.env.RUN_URL || "(run url unavailable)";
const REPO = process.env.GITHUB_REPOSITORY || "(repo unknown)";

async function main() {
  const missing = [
    ["GMAIL_USER", GMAIL_USER],
    ["GMAIL_APP_PASSWORD", GMAIL_APP_PASSWORD],
    ["BACKUP_TO_EMAIL", BACKUP_TO_EMAIL],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length) {
    console.error(
      `[notify] Cannot send the failure alert: ${missing.join(", ")} not set. ` +
        `Add these under Settings > Secrets and variables > Actions, then re-run.`
    );
    return;
  }

  const date = new Date().toISOString().slice(0, 10);
  // Timeouts matter here. Without them nodemailer does not fail when Gmail
  // is unreachable -- it just waits, and the step hangs until GitHub's job
  // timeout. Found by testing this script with no route to Gmail: it sat
  // there until killed at 60s rather than erroring. An alert that cannot be
  // delivered should give up quickly and say so in the log.
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });

  await transporter.sendMail({
    from: GMAIL_USER,
    to: BACKUP_TO_EMAIL,
    subject: `❌ HiTech Daily Backup FAILED — ${date}`,
    text: [
      `The Daily Backup did not run successfully.`,
      ``,
      `No backup file was produced for ${date}.`,
      ``,
      `Repository: ${REPO}`,
      `Job log:    ${RUN_URL}`,
      ``,
      `Open the job log to see which step failed. The most common cause is a`,
      `missing or incorrect GitHub Actions secret — the log prints the name of`,
      `the first one it could not find.`,
      ``,
      `Until this is fixed there is no daily backup of the accounting data.`,
    ].join("\n"),
  });

  console.log(`[notify] failure alert sent to ${BACKUP_TO_EMAIL}`);
}

// Belt and braces: even with the transport timeouts above, never let this
// step outlive the job it is reporting on.
const HARD_LIMIT_MS = 45000;

Promise.race([
  main(),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`gave up after ${HARD_LIMIT_MS / 1000}s`)), HARD_LIMIT_MS).unref()
  ),
]).catch((err) => {
  // Never mask the real failure with a second error.
  console.error(`[notify] Could not send the failure alert: ${err.message}`);
});
