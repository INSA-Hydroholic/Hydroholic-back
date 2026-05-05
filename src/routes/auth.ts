import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { UserDAO } from '../dao/user.dao';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import axios from 'axios';
import { prisma } from '../lib/prisma';
import { HydrationService } from '../service/hydration.service';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-secret';
console.log(`Using JWT secret: ${JWT_SECRET}`);
const JWT_EXPIRES_IN = '7d';

// little helper to create JWT token
const createToken = (userId: number, username: string): string => {
  return jwt.sign({ sub: userId, username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

// 1. register
router.post('/register', async (req: Request, res: Response) => {
  try {
    // 1. get registration info from request body and validate
    const { email, password, gender, birthDate, weight, height } = req.body;

    if (!email || !password || !height || !weight || !gender || !birthDate) {
      return res.status(400).json({ error: 'Missing required registration fields' });
    }

    // 2. hash the password before storing
    const hashedPassword = await bcrypt.hash(password, 10);

    // 3. call ML service for cold-start prediction to get initial hydration target and persona assignment
    const birthYear = new Date(birthDate).getFullYear();
    const currentYear = new Date().getFullYear();
    const age = currentYear - birthYear;
    let initialTarget = weight * 30;
    let assignedPersonaId = null;
    const genderEncoded = gender.toLowerCase() === 'female' ? 1 : 0;
    try {
      // timeout set to 3 seconds to prevent blocking registration if ML service is slow/unavailable
      const mlResponse = await axios.post(
        'http://localhost:5000/predict/cold-start', 
        {
          height: height,
          weight: weight,
          age: age,
          gender_encoded: genderEncoded
        },
        { timeout: 3000 } 
      );

      if (mlResponse.data && mlResponse.data.recommended_target) {
        initialTarget = mlResponse.data.recommended_target;
        assignedPersonaId = mlResponse.data.persona_id;
        console.log(`[ML] Cold-start successful. Assigned to Persona ${assignedPersonaId}, Target: ${initialTarget}ml`);
      }
    } catch (mlError: any) {
      console.warn(`[ML-Fallback] Cold-start API failed (${mlError.message}). Using default medical formula.`);
    }
    const calculatedTarget = HydrationService.calculatePersonalizedGoal({
          weight,
          age,
          gender: gender === 'male' ? 'H' : 'F',
          intenseMin: 0,
          moderateMin: 0,
          temp: 20
    });
    const initialratio = initialTarget / calculatedTarget;

    // 4. create the user in the database with the initial ratio and persona info
    const newUser = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        height,
        weight,
        age,
        gender,
        hydrationSensitivity: 1.0,      
        dailyHydrationCoefficient: initialratio, 
      }
    });

    // send back to frontend the user info along with the initial target and persona assignment for immediate use in the app
    // const token = generateToken(newUser.id); 

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: newUser.id,
        email: newUser.email,
        dailyTarget: initialTarget,
        assignedPersona: assignedPersonaId
      }
    });

  } catch (error) {
    console.error('[Auth] Registration error:', error);
    res.status(500).json({ error: 'Internal server error during registration' });
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