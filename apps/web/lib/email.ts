import { serverEnv } from "./env";

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Email transport seam. No provider is wired yet. In development the message (including the
 * verification or reset link) is printed to the server console. In production it refuses to
 * pretend an email was sent: configure a provider here before launch.
 */
export async function sendEmail(message: OutboundEmail): Promise<void> {
  if (serverEnv().NODE_ENV !== "production") {
    console.info(`[email:dev] to=${message.to} subject="${message.subject}"\n${message.text}`);
    return;
  }
  throw new Error("No email provider configured. Implement sendEmail() in apps/web/lib/email.ts.");
}
