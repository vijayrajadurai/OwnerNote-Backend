import { z } from "zod";
import "dotenv/config";

// Exact secret values that ship (as examples/dev defaults) in this repo's
// .env / .env.example / .env.test / .env.production.example. None of
// these are safe in production — if one of them ends up in a real deploy
// it's because someone copied the example file verbatim rather than
// generating a real secret.
const KNOWN_PLACEHOLDER_JWT_SECRETS = new Set([
  "dev-only-secret-please-change-1234567890",
  "change-me-to-a-long-random-string",
  "test-only-secret-please-change-1234567890",
  "GENERATE_A_RANDOM_32_PLUS_CHARACTER_SECRET",
]);

// Stricter than the general-purpose min(16) below: 16 characters is enough
// to boot in dev/test, but a production JWT signing secret should carry
// meaningfully more entropy.
const PRODUCTION_MIN_JWT_SECRET_LENGTH = 32;
// Below this many distinct characters, a string long enough to pass the
// length check can still be something like "aaaaaaaa...bbbb" — reject those
// too, without being so strict that a real random secret could ever trip it.
const PRODUCTION_MIN_JWT_SECRET_CHAR_VARIETY = 8;

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().default(4000),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
    JWT_EXPIRES_IN: z.string().default("30d"),
    OTP_PROVIDER: z.enum(["console", "msg91", "twilio"]).default("console"),
    OTP_TTL_SECONDS: z.coerce.number().default(300),
    OTP_MAX_ATTEMPTS: z.coerce.number().default(5),
    MSG91_AUTH_KEY: z.string().optional(),
    MSG91_TEMPLATE_ID: z.string().optional(),
    MSG91_SENDER_ID: z.string().optional(),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_VERIFY_SERVICE_SID: z.string().optional(),
    CORS_ORIGIN: z.string().default("*"),
    // A fixed username/password login, entirely separate from the real
    // phone+OTP flow, for testing the app before a real OTP provider
    // (MSG91/Twilio) is wired up. Off by default; never allowed when
    // NODE_ENV=production (see the superRefine guard below) — this is a
    // testing convenience, not a real auth mechanism.
    TEST_LOGIN_ENABLED: z
      .string()
      .default("false")
      .transform((value) => value.trim().toLowerCase() === "true"),
    TEST_LOGIN_USERNAME: z.string().optional(),
    TEST_LOGIN_PASSWORD: z.string().optional(),
    // Express's own default is `false` (no proxy trust, req.ip is always the
    // raw socket address) — that's also our default here, so leaving
    // TRUST_PROXY unset preserves current dev/test behavior exactly. In
    // production this must be set to the actual number of reverse-proxy
    // hops in front of this server (the final hosting topology isn't
    // chosen yet, so there's no safe value to hardcode here). Deliberately
    // does NOT accept "true" — that tells Express to trust an arbitrary
    // number of forwarded hops, i.e. blindly trust whatever X-Forwarded-For
    // a client sends, which is the exact misconfiguration this guards
    // against.
    TRUST_PROXY: z
      .string()
      .default("false")
      .transform((value, ctx) => {
        const trimmed = value.trim();
        if (trimmed === "false") return false as const;
        if (/^\d+$/.test(trimmed)) return Number(trimmed);
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'TRUST_PROXY must be "false" or a non-negative integer hop count — the number of reverse proxies ' +
            'directly in front of this server (e.g. "1" for a single load balancer). "true" is not accepted: it ' +
            "would trust an unbounded chain of forwarded headers.",
        });
        return z.NEVER;
      }),
  })
  // Cross-field, production-only checks. These never run for
  // development/test — see the NODE_ENV guard at the top of each branch —
  // so dev/test boot behavior is unchanged.
  .superRefine((data, ctx) => {
    if (data.TEST_LOGIN_ENABLED) {
      if (data.NODE_ENV === "production") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["TEST_LOGIN_ENABLED"],
          message:
            "TEST_LOGIN_ENABLED=true is not allowed when NODE_ENV=production — it bypasses OTP verification " +
            "entirely with a fixed username/password. Disable it (or unset it) before deploying to production.",
        });
      }
      if (!data.TEST_LOGIN_USERNAME || !data.TEST_LOGIN_PASSWORD) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["TEST_LOGIN_USERNAME"],
          message: "TEST_LOGIN_ENABLED=true requires both TEST_LOGIN_USERNAME and TEST_LOGIN_PASSWORD to be set.",
        });
      }
    }

    if (data.NODE_ENV !== "production") return;

    if (data.OTP_PROVIDER === "console") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["OTP_PROVIDER"],
        message:
          "OTP_PROVIDER=console is not allowed when NODE_ENV=production (it prints OTP codes to the server log, " +
          "which would let anyone with log access sign in as any user). Set OTP_PROVIDER to msg91 or twilio and " +
          "supply the matching credentials.",
      });
    }

    if (KNOWN_PLACEHOLDER_JWT_SECRETS.has(data.JWT_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["JWT_SECRET"],
        // Deliberately does not echo the secret value back.
        message:
          "JWT_SECRET is set to a known placeholder value copied from .env/.env.example/.env.test/.env.production.example. " +
          "Generate a unique, random production secret before deploying.",
      });
    } else if (data.JWT_SECRET.length < PRODUCTION_MIN_JWT_SECRET_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["JWT_SECRET"],
        message: `JWT_SECRET must be at least ${PRODUCTION_MIN_JWT_SECRET_LENGTH} characters when NODE_ENV=production.`,
      });
    } else if (new Set(data.JWT_SECRET).size < PRODUCTION_MIN_JWT_SECRET_CHAR_VARIETY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["JWT_SECRET"],
        message: "JWT_SECRET does not have enough character variety to be a safe production secret.",
      });
    }

    const corsOrigins = data.CORS_ORIGIN.split(",").map((origin) => origin.trim());
    if (corsOrigins.some((origin) => origin === "*")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CORS_ORIGIN"],
        message:
          'CORS_ORIGIN="*" is not allowed when NODE_ENV=production. Set one or more explicit origins, e.g. ' +
          "CORS_ORIGIN=https://admin.example.com or a comma-separated list of allowed origins.",
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const fieldErrors = parsed.error.flatten().fieldErrors;
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:", fieldErrors);
  const messages = parsed.error.issues.map((issue) => issue.message).join(" ");
  throw new Error(`Invalid environment configuration. ${messages}`);
}

export const env = parsed.data;
