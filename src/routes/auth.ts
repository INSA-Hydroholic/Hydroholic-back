// src/routes/auth.ts
import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import { UserDAO } from '../dao/user.dao';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-secret';
const JWT_EXPIRES_IN = '7d';

const createToken = (userId: number, username: string): string => {
  return jwt.sign({ sub: userId, username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

// 1. Inscription (Register)
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, fullname } = req.body;
    const passwordHash = password; // ON NE HASHE PLUS ICI
    const newUser = await UserDAO.createUser({
      username,
      email,
      password_hash: passwordHash,
      surname: fullname || 'Utilisateur',
      name: '',
    });
    const token = createToken(newUser.id, newUser.username);
    const { password_hash, ...safeUser } = newUser;
    res.status(201).json({ token, user: safeUser });
  } catch (error: any) {
    res.status(500).json({ message: 'Erreur register', error: error.message });
  }
});

// 2. Connexion (Login) - UNE SEULE ROUTE ICI
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const users = await UserDAO.getByInfo({
      OR: [{ username }, { email: username }]
    });
    const user = users[0];

    if (!user) return res.status(401).json({ message: 'Identifiants invalides' });

    // COMPARAISON TEXTE BRUT
    if (password !== user.password_hash) {
      return res.status(401).json({ message: 'Identifiants invalides' });
    }

    const token = createToken(user.id, user.username);
    const { password_hash, ...safeUser } = user;
    res.status(200).json({ token, user: safeUser });
  } catch (error: any) {
    res.status(500).json({ message: 'Erreur de connexion' });
  }
});

export default router;