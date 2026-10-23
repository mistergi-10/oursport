export async function sendPasswordResetEmail(email: string, code: string) {
  if (process.env.NODE_ENV !== "production") {
    console.log(`[dev email] password reset code for ${email}: ${code}`);
    return;
  }

  if (!process.env.EMAIL_FROM || !process.env.EMAIL_PROVIDER_API_KEY) {
    console.warn(`Email provider not configured; skipped password reset email to ${email}`);
    return;
  }

  // No transactional email provider is wired up yet; this is a placeholder
  // for a future slice (e.g. Resend/SendGrid/Postmark/SES integration).
  console.warn(`Email provider configured but sending is not implemented; skipped email to ${email}`);
}
