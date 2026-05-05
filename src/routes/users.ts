import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { UserDAO } from '../dao/user.dao';
import { HydrationDAO } from '../dao/hydration.dao';
import { authMiddleware } from '../middlewares/auth.middleware';

const router = Router();
import { prisma } from '../lib/prisma';
import { HydrationService } from '../service/hydration.service';

// get all users
router.get('/', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: {
        role: "RESIDENT"
      },
      select: { 
        id: true,
      username: true,
      email: true,
      surname: true,
      name: true,
      room : true,
      daily_goal: true,
      esp32Id: true,
      role: true,
      organizationId: true,
      age: true,
      weight: true,
      sex: true,
      }
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: `Server error: ${error}` });
  }
});

// get user by id
router.get('/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const user = await UserDAO.getUserById(userId);
    
    if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });

    const { password_hash, ...safeUser } = user;
    res.json(safeUser);
  } catch (error) {
    res.status(500).json({ message: `Server error: ${error}` });
  }
});

// get user ranking (based on total water consumed)
router.get('/ranking/all', async (req, res) => {
  const ranking = await prisma.hydrationLog.groupBy({
    by: ['userID'],
    // TODO: the ranking should be calculated on a time range (e.g. last 7 days) instead of all time
    _sum: { weight: true },
    orderBy: { _sum: { weight: 'desc' } },
    take: 10
  });

  const userIds = ranking.map(r => r.userID);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true }
  });

  const fullRanking = ranking.map(r => ({
    ...r,
    username: users.find(u => u.id === r.userID)?.username || 'Unknown'
  }));
  res.json(fullRanking);
});

router.post('/:userId/water', authMiddleware, async (req: any, res: any) => {
  try {
    const userIdFromUrl = parseInt(req.params.userId);
    const authenticatedUserId = req.user.sub;

    if (isNaN(userIdFromUrl) || userIdFromUrl !== authenticatedUserId) {
      console.warn(`User ${authenticatedUserId} attempted to log water for user ${userIdFromUrl}`);
      return res.status(403).json({ message: 'You can not add water for another user' });
    }
    const { weight, source, measured_at } = req.body;

    if (!weight || weight <= 0) {
      console.warn(`Invalid weight value from user ${authenticatedUserId}: ${weight}`);
      return res.status(400).json({ message: `Weight must be a positive number. Received: ${weight}` });
    }

    const newLog = await HydrationService.logWater({
      userId: userIdFromUrl,
      weight,
      source: source || 'app',
      measured_at: measured_at
    });
    console.log(`New hydration log for user ${userIdFromUrl}: ${weight}g from source ${source} at ${measured_at}`);
    res.json({ message: 'Log ajoutée avec succès', data: newLog });

  } catch (error) {
    console.error(`Error logging water for user ${req.params.userId}:`, error);
    res.status(500).json({ message: `Server error: ${error}` });
  }
});

// Get weight logs for a user - TODO : rename to weight-related name
router.get('/:userId/water', async (req: any, res: any) => {
  try {
    const userIdFromUrl = parseInt(req.params.userId);
    const history = await HydrationDAO.getHistoryByUserId(userIdFromUrl);
    res.json(history);
  } catch (error) {
    res.status(500).json({ message: `Server error: ${error}` });
  }
});

// Retrieve water consumption between two dates for a user based on weight logs
router.get('/:userId/consumption', async (req: any, res: any) => {
  try {
    const userIdFromUrl = parseInt(req.params.userId);
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'No startDate or endDate provided.' });
    }
    const consumption = await HydrationDAO.getTotalConsumedByRange(userIdFromUrl, new Date(startDate), (() => { const d = new Date(endDate); d.setHours(23,59,59,999); return d; })());
    res.json({ totalVolume: consumption });
  } catch (error) {
    res.status(500).json({ message: `Server error: ${error}` });
  }
});

// get fake recommendations for a user (this is just a placeholder)
router.get('/:userId/recommendations', (req, res) => {
  const recommendations = [
    { id: 'r1', title: 'Bois plus tôt', description: 'Commence ta journée avec un verre d eau.' },
    { id: 'r2', title: 'Fixe des rappels', description: 'Programmes 3 rappels pour boire toutes les 2 h.' },
    { id: 'r3', title: 'Varie tes boissons', description: 'Ajoute citron, menthe ou thé vert à ton eau.' }
  ];
  res.json(recommendations);
});

router.post('/:userId/goal/calculate', authMiddleware, async (req: any, res: any) => {
  try {
    const userId = parseInt(req.params.userId);
    const { weight, age, gender, intenseMin, moderateMin, isHot } = req.body;

    // Validation rapide des données reçues
    if (!weight || !age || !gender) {
      return res.status(400).json({ message: "Données manquantes (poids, âge ou sexe)" });
    }

    // 1. Calculer le nouvel objectif avec la formule
    const recommendedGoal = HydrationService.calculatePersonalizedGoal({
      weight,
      age,
      gender,
      intenseMin: intenseMin || 0,
      moderateMin: moderateMin || 0,
      isHot: isHot || false
    });

    // 2. Mettre à jour l'utilisateur dans la base de données
    const updatedUser = await UserDAO.updateDailyGoal(userId, recommendedGoal);

    res.json({
      message: "Objectif personnalisé mis à jour avec succès",
      daily_goal: updatedUser.daily_goal
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur lors du calcul de l'objectif" });
  }
});

export default router;