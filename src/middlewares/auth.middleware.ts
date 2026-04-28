import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-secret';

export type AuthRequest = Request & {
  user?: { 
    sub: number;
    username: string; 
  };
}

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  // 1. check if the Authorization header exists and starts with 'Bearer '
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Accès refusé : Token manquant' });
  }

  // 2. delete bearer and get the pure token string
  const token = authHeader.replace('Bearer ', '');

  try {
    // 3. chekk if the token is valid and not expired
    const decoded = jwt.verify(token, JWT_SECRET) as unknown as { sub: number; username: string };
    
    // 4. successfully verified, attach the user info to req.user for downstream use
    req.user = decoded;

    next();
    
  } catch (err) {
    // if token is invalid or expired, respond with 401
    return res.status(401).json({ message: 'Accès refusé : Token invalide ou expiré' });
  }
};