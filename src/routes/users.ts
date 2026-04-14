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
      select: { id: true, username: true, email: true, nom: true, daily_goal: true }
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
      return res.status(403).json({ message: 'You can not add water for another user' });
    }
    const { weight } = req.body;

    if (!weight || weight <= 0) {
      return res.status(400).json({ message: `Weight must be a positive number. Received: ${weight}` });
    }
    const newLog = await HydrationService.logWater(userIdFromUrl, weight, 'app');

    res.json({ message: 'Eau ajoutée avec succès', data: newLog });

  } catch (error) {
    res.status(500).json({ message: `Server error: ${error}` });
  }
});

// Get hydration logs for a user (with authentication)
router.get('/:userId/water', authMiddleware, async (req: any, res: any) => {
  try {
    const userIdFromUrl = parseInt(req.params.userId);
    // const authenticatedUserId = req.user.sub;
    // if (isNaN(userIdFromUrl) || userIdFromUrl !== authenticatedUserId) {
    //   return res.status(403).json({ message: 'You can not view history for another user' });
    // }

    const history = await HydrationDAO.getHistoryByUserId(userIdFromUrl);
    res.json(history);
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

export default router;