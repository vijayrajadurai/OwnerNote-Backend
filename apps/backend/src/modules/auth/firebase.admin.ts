import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getMessaging, type Messaging } from "firebase-admin/messaging";
import { env, hasFirebaseAdminCredentials } from "../../config/env";
import { ServiceUnavailableError, UnauthorizedError } from "../../utils/errors";

export type FirebasePhoneIdentity = {
  phone: string;
  firebaseUid: string;
};

export type FirebaseIdTokenVerifier = (idToken: string) => Promise<FirebasePhoneIdentity>;

let overrideVerifier: FirebaseIdTokenVerifier | null = null;

export function setFirebaseIdTokenVerifierForTests(verifier: FirebaseIdTokenVerifier | null): void {
  overrideVerifier = verifier;
}

function initFirebaseAdmin(): void {
  if (getApps().length > 0) return;

  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const parsed = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON) as {
      project_id?: string;
      client_email?: string;
      private_key?: string;
    };
    initializeApp({
      credential: cert({
        projectId: parsed.project_id,
        clientEmail: parsed.client_email,
        privateKey: parsed.private_key,
      }),
    });
    return;
  }

  initializeApp({
    credential: cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

export async function verifyFirebasePhoneIdToken(idToken: string): Promise<FirebasePhoneIdentity> {
  if (overrideVerifier) {
    return overrideVerifier(idToken);
  }

  if (!hasFirebaseAdminCredentials(env)) {
    throw new ServiceUnavailableError(
      "Firebase Admin is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.",
    );
  }

  try {
    initFirebaseAdmin();
    const decoded = await getAuth().verifyIdToken(idToken);
    const phone = decoded.phone_number;
    if (!phone) {
      throw new UnauthorizedError("Firebase token has no verified phone number.");
    }
    return { phone, firebaseUid: decoded.uid };
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ServiceUnavailableError) {
      throw err;
    }
    throw new UnauthorizedError("Invalid or expired Firebase ID token.");
  }
}

export function tryGetFirebaseMessaging(): Messaging | null {
  if (!hasFirebaseAdminCredentials(env)) return null;
  try {
    initFirebaseAdmin();
    return getMessaging();
  } catch {
    return null;
  }
}
