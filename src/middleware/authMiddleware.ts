// src/middleware/authMiddleware.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  user?: { id: string } & Record<string, unknown>;
}

export const protect = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Not authorized, no token' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({ message: 'Not authorized, no token' });
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // Validated at startup, but guard here too so we never verify with an
    // empty/undefined secret (which jsonwebtoken would otherwise throw on).
    res.status(500).json({ message: 'Server misconfiguration' });
    return;
  }

  try {
    const decoded = jwt.verify(token, secret) as { id: string } & Record<string, unknown>;
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ message: 'Not authorized, token failed' });
    return;
  }
};
