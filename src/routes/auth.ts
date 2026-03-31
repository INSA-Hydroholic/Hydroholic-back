import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { UserDAO } from '../dao/user.dao';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-secret';
const JWT_EXPIRES_IN = '7d';

// little helper to create JWT token
const createToken = (userId: number, username: string): string => {
  return jwt.sign({ sub: userId, username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

// 1. register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, fullname } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ message: 'username, email et password sont requis' });
    }

    const existingUsers = await UserDAO.getByInfo({
      OR: [{ username }, { email }]
    });
    
    if (existingUsers.length > 0) {
      return res.status(409).json({ message: 'Utilisateur déjà existant' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = await UserDAO.createUser({
      username,
      email,
      password_hash: passwordHash,
      nom: fullname || 'Utilisateur',
      prenom: '',
    });

    const token = createToken(newUser.id, newUser.username);
    const { password_hash, ...safeUser } = newUser;
    
    res.status(201).json({ token, user: safeUser });
  } catch (error) {
    res.status(500).json({ message: 'Erreur lors de la création du compte', error });
  }
});

//login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const users = await UserDAO.getByInfo({
      OR: [{ username }, { email: username }]
    });
    const user = users[0];

    if (!user) {
      return res.status(401).json({ message: 'Identifiants invalides' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ message: 'Identifiants invalides' });
    }

    const token = createToken(user.id, user.username);
    const { password_hash, ...safeUser } = user;
    
    res.status(200).json({ token, user: safeUser });
  } catch (error) {
    res.status(500).json({ message: 'Erreur de connexion' });
  }
});

// 3. get current user
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ message: 'Non autorisé' });

    const user = await UserDAO.getUserById(userId);
    if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });

    const { password_hash, ...safeUser } = user;
    res.json(safeUser);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

export default router;