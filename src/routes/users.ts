import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { UserDAO } from '../dao/user.dao';
import { HydrationDAO } from '../dao/hydration.dao';
import { authMiddleware } from '../middlewares/auth.middleware';

const router = Router();
const prisma = new PrismaClient();

// get all users
router.get('/', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, username: true, email: true, nom: true, daily_goal: true }
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
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
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// get user ranking (based on total water consumed)
// 推荐在 src/routes/users.ts 中这样改写排行榜接口
router.get('/ranking/all', async (req, res) => {
  try {
    const ranking = await prisma.hydrationLog.groupBy({
      by: ['userID'],
      _sum: {
        volume_ml: true,
      },
      orderBy: {
        _sum: {
          volume_ml: 'desc',
        },
      },
    });
    res.json(ranking);
  } catch (error) {
    res.status(500).json({ message: 'Erreur lors du calcul du classement' });
  }
});

router.post('/:userId/water', authMiddleware, async (req: any, res: any) => {
  try {
    const userIdFromUrl = parseInt(req.params.userId);
    const authenticatedUserId = req.user.sub;

    if (isNaN(userIdFromUrl) || userIdFromUrl !== authenticatedUserId) {
      return res.status(403).json({ message: 'you can not add water for another user' });
    }
    const { amountMl } = req.body;

    if (!amountMl || amountMl <= 0) {
      return res.status(400).json({ message: 'amountMl > 0 requis' });
    }

    const newLog = await HydrationDAO.createHydrationLog({
      user: { connect: { id: userIdFromUrl } },
      weight_value: amountMl,
      volume_ml: amountMl,
      source: 'app',
    });

    res.json({ message: 'Eau ajoutée avec succès', data: newLog });
    
  } catch (error) {
    res.status(500).json({ message: 'server error' });
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