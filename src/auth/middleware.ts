import type { Request, Response, NextFunction } from "express";
import type Database from "better-sqlite3";
import { verifyJwt, type JwtPayload } from "../utils/crypto.js";
import { verifyFirebaseToken, isFirebaseEnabled } from "./firebase.js";
import {
  findUserByFirebaseUid,
  createFirebaseUser,
  updateFirebaseUser,
} from "../database/users.js";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

let _db: Database.Database | null = null;

export function setAuthDb(db: Database.Database): void {
  _db = db;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid authorization header" });
    return;
  }

  const token = authHeader.slice(7);

  // Try local JWT first (fast, sync)
  const localPayload = verifyJwt(token);
  if (localPayload) {
    req.user = localPayload;
    next();
    return;
  }

  // Try Firebase token (async)
  if (isFirebaseEnabled() && _db) {
    verifyFirebaseToken(token)
      .then((fbUser) => {
        if (!fbUser) {
          res.status(401).json({ error: "Invalid or expired token" });
          return;
        }

        // Find or create local user for this Firebase user
        let localUser = findUserByFirebaseUid(_db!, fbUser.uid);

        if (!localUser) {
          // Auto-create on first sign-in
          localUser = createFirebaseUser(_db!, {
            firebaseUid: fbUser.uid,
            email: fbUser.email,
            displayName: fbUser.displayName,
            photoUrl: fbUser.photoURL,
            provider: fbUser.provider,
          });
        } else {
          // Update profile info if changed
          updateFirebaseUser(_db!, localUser.id, {
            displayName: fbUser.displayName,
            photoUrl: fbUser.photoURL,
            email: fbUser.email,
          });
        }

        req.user = { userId: localUser.id, role: localUser.role };
        next();
      })
      .catch(() => {
        res.status(401).json({ error: "Authentication failed" });
      });
    return;
  }

  res.status(401).json({ error: "Invalid or expired token" });
}

export function adminMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
