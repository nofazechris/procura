import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb, schema } from "@procura/database";
import { sendEmail } from "./email";
import { serverEnv } from "./env";

/**
 * Self-hosted authentication on Neon via Better Auth. This replaces Supabase Auth from the
 * Technical PRD: email + password, email verification, password recovery, persistent sessions.
 *
 * Created lazily so importing this module (e.g. during `next build`) never needs secrets.
 */
function create() {
  const env = serverEnv();
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL ?? env.NEXT_PUBLIC_APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION === "true",
      sendResetPassword: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: "Reset your Procura password",
          text: `Hi ${user.name},\n\nReset your password: ${url}\n\nIf you did not ask for this, ignore this email.`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: "Verify your Procura email",
          text: `Hi ${user.name},\n\nConfirm your email to finish setting up Procura: ${url}`,
        });
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 14, // 14 days: persistent sessions
      updateAge: 60 * 60 * 24,
    },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof create>;
let instance: Auth | undefined;

export function getAuth(): Auth {
  return (instance ??= create());
}
