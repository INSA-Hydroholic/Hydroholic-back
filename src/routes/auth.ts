// src/routes/auth.ts
import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import { UserDAO } from '../dao/user.dao';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { prisma } from '../lib/prisma';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-secret';
const JWT_EXPIRES_IN = '7d';

const createToken = (userId: number, username: string): string => {
  return jwt.sign({ sub: userId, username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

// 1. Inscription (Register)
router.post('/register', async (req, res) => {
  try {
    const { 
      username, 
      password, 
      orgName, 
      adminAddress, 
      adminName, 
      adminFirstName, 
      adminEmail 
    } = req.body;

    // We use a transaction to create both entities
    const result = await prisma.$transaction(async (tx) => {
      
      // 1. Créer l'Organisation
      const organization = await tx.organization.create({
        data: {
          name: orgName,
          adresse: adminAddress,
          type: "EHPAD", 
        }
      });

      // We create the user admin
      const user = await tx.user.create({
        data: {
          username: username,
          email: adminEmail,
          password_hash: password, 
          surname: adminName,      
          name: adminFirstName,  
          role: "ADMIN",
          organizationId: organization.id
        }
      });

      return { user, organization };
    });

    const token = createToken(result.user.id, result.user.username);
    
    // We get rid the the password before sending it back
    const { password_hash, ...safeUser } = result.user;

    res.status(201).json({ 
      token, 
      user: { 
        ...safeUser, 
        organizationName: result.organization.name 
      } 
    });

  } catch (error: any) {
    // On attrape l'erreur de doublon spécifique à Prisma (P2002)
    if (error.code === 'P2002') {
      const targets = error.meta?.target || [];
      
      // On vérifie si l'un des éléments du tableau contient le mot clé
      // On utilise .toLowerCase() pour éviter les problèmes de casse
      const isUsername = targets.some((t: string) => t.toLowerCase().includes('username'));
      const isEmail = targets.some((t: string) => t.toLowerCase().includes('email'));

      if (isUsername) {
        return res.status(409).json({ 
          message: "L'identifiant est déjà utilisé par un autre utilisateur." 
        });
      } 
      
      if (isEmail) {
        return res.status(409).json({ 
          message: "L'adresse email est déjà utilisée par un autre établissement." 
        });
      }

      // Message par défaut si c'est une autre contrainte unique qui saute
      return res.status(409).json({ 
        message: "Cette information est déjà utilisée par un autre établissement." 
      });
    }

    console.error("Erreur Register détaillée :", error);
    res.status(500).json({ message: "Erreur serveur lors de l'inscription" });
  }
});

// 2. Connexion (Login)
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