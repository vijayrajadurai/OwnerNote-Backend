import { env } from "../../config/env";
import { logger } from "../../utils/logger";

/**
 * Provider-independent OTP delivery abstraction. Swap providers via OTP_PROVIDER
 * without touching auth.service.ts or any caller.
 */
export interface OtpProvider {
  sendOtp(phone: string, code: string): Promise<void>;
}

// Test-only hook so integration tests can complete the OTP flow without a
// real SMS provider. Never populated outside NODE_ENV=test.
export let lastConsoleOtpForTests: { phone: string; code: string } | null = null;

class ConsoleOtpProvider implements OtpProvider {
  async sendOtp(phone: string, code: string): Promise<void> {
    // Dev-only provider: prints the OTP instead of sending a real SMS.
    logger.info({ phone }, `[DEV OTP] Code for ${phone}: ${code}`);
    if (env.NODE_ENV === "test") {
      lastConsoleOtpForTests = { phone, code };
    }
  }
}

class Msg91OtpProvider implements OtpProvider {
  async sendOtp(phone: string, code: string): Promise<void> {
    if (!env.MSG91_AUTH_KEY || !env.MSG91_TEMPLATE_ID) {
      throw new Error(
        "OTP_PROVIDER=msg91 requires MSG91_AUTH_KEY and MSG91_TEMPLATE_ID to be set. " +
          "See apps/backend/.env.example.",
      );
    }
    const res = await fetch("https://control.msg91.com/api/v5/otp", {
      method: "POST",
      headers: { "Content-Type": "application/json", authkey: env.MSG91_AUTH_KEY },
      body: JSON.stringify({
        template_id: env.MSG91_TEMPLATE_ID,
        mobile: phone,
        otp: code,
        sender: env.MSG91_SENDER_ID,
      }),
    });
    if (!res.ok) {
      throw new Error(`MSG91 OTP send failed with status ${res.status}`);
    }
  }
}

class TwilioOtpProvider implements OtpProvider {
  async sendOtp(_phone: string, _code: string): Promise<void> {
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_VERIFY_SERVICE_SID) {
      throw new Error(
        "OTP_PROVIDER=twilio requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and " +
          "TWILIO_VERIFY_SERVICE_SID to be set. See apps/backend/.env.example.",
      );
    }
    // Twilio Verify manages code generation itself; wire the real client here when
    // credentials are available. Left as a documented extension point for now.
    throw new Error("Twilio OTP provider is not yet wired to the Twilio Verify API.");
  }
}

export function getOtpProvider(): OtpProvider {
  switch (env.OTP_PROVIDER) {
    case "msg91":
      return new Msg91OtpProvider();
    case "twilio":
      return new TwilioOtpProvider();
    case "console":
    default:
      return new ConsoleOtpProvider();
  }
}
