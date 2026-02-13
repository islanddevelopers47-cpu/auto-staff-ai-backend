import admin from "firebase-admin";
import fs from "node:fs";
import path from "node:path";
import { getEnv } from "../config/env.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("firebase");

let _app: admin.app.App | null = null;

export function initFirebase(): boolean {
  const env = getEnv();

  // Try explicit path first, then auto-detect in project root
  let serviceAccountPath = env.FIREBASE_SERVICE_ACCOUNT_PATH;

  if (!serviceAccountPath) {
    // Auto-detect service account file in project root
    const cwd = process.cwd();
    const files = fs.readdirSync(cwd).filter(
      (f) => f.includes("firebase-adminsdk") && f.endsWith(".json")
    );
    if (files.length > 0) {
      serviceAccountPath = path.resolve(cwd, files[0]);
    }
  }

  // Also support inline JSON from env var (for Railway/cloud deploys where file isn't committed)
  let serviceAccountData: any = null;
  if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
    serviceAccountData = JSON.parse(fs.readFileSync(serviceAccountPath, "utf-8"));
  } else if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      serviceAccountData = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
      log.info("Loaded Firebase service account from FIREBASE_SERVICE_ACCOUNT_JSON env var");
    } catch (parseErr) {
      log.error("Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON env var");
    }
  }

  if (!serviceAccountData) {
    log.warn("Firebase service account not found — Firebase auth disabled");
    return false;
  }

  try {
    const serviceAccount = serviceAccountData;

    _app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: env.FIREBASE_PROJECT_ID,
    });

    log.info(`Firebase Admin initialized (project: ${env.FIREBASE_PROJECT_ID})`);
    return true;
  } catch (err) {
    log.error(`Firebase initialization failed: ${err}`);
    return false;
  }
}

export function getFirebaseApp(): admin.app.App | null {
  return _app;
}

export function isFirebaseEnabled(): boolean {
  return _app !== null;
}

export interface FirebaseUser {
  uid: string;
  email: string | undefined;
  displayName: string | undefined;
  photoURL: string | undefined;
  provider: string;
}

/**
 * Verify a Firebase ID token and return the decoded user info.
 */
export async function verifyFirebaseToken(
  idToken: string
): Promise<FirebaseUser | null> {
  if (!_app) return null;

  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return {
      uid: decoded.uid,
      email: decoded.email,
      displayName: decoded.name,
      photoURL: decoded.picture,
      provider: decoded.firebase?.sign_in_provider || "unknown",
    };
  } catch (err) {
    return null;
  }
}
