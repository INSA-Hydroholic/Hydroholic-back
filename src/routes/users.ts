import { Router } from 'express';
import axios from 'axios';
import { UserDAO } from '../dao/user.dao';
import { HydrationDAO } from '../dao/hydration.dao';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';


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
    const consumption = await HydrationDAO.getTotalConsumedByRange(userIdFromUrl, new Date(startDate), new Date(endDate));
    res.json({ totalVolume: consumption });
  } catch (error) {
    res.status(500).json({ message: `Server error: ${error}` });
  }
});

// Update user profile
router.put('/profile', authMiddleware, async (req: any, res: any) => {
  try {
    const userId = parseInt(req.user.sub || req.user.id);
    if (isNaN(userId)) {
      return res.status(400).json({ message: "ID utilisateur invalide dans le token" });
    }
    const updates = req.body;

    // 1. validate input data
    const validData: any = {};
    
    if (updates.nom) validData.nom = updates.nom;
    if (updates.prenom) validData.prenom = updates.prenom;
    if (updates.email) validData.email = updates.email;
    if (updates.region) validData.region = updates.region; 
    if (updates.biography !== undefined) validData.biography = updates.biography;
    
    if (updates.age !== undefined) {
      if (updates.age < 0 || updates.age > 120) return res.status(400).json({ message: "Invalid age" });
      validData.age = updates.age;
    }
    
    if (updates.daily_goal !== undefined) {
      if (updates.daily_goal <= 0) return res.status(400).json({ message: "Daily goal must be positive" });
      validData.daily_goal = updates.daily_goal;
    }

    if (updates.weight !== undefined) {
      if (updates.weight <= 0) return res.status(400).json({ message: "Invalid weight" });
      validData.weight = updates.weight;
    }

    if (updates.num_moderate_activities !== undefined) {
      if (updates.num_moderate_activities < 0) return res.status(400).json({ message: "Invalid number of moderate activities" });
      validData.num_moderate_activities = parseInt(updates.num_moderate_activities);
    }
    if (updates.num_intense_activities !== undefined) {
      if (updates.num_intense_activities < 0) return res.status(400).json({ message: "Invalid number of intense activities" });
      validData.num_intense_activities = parseInt(updates.num_intense_activities);
    }

    // 2. update user profile
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: validData,
      select: {
        id: true,
        email: true,
        username: true,
        nom: true,
        prenom: true,
        age: true,
        weight: true,
        daily_goal: true,
        avatar_url: true
      }
    });

    res.json({
      message: "Profile updated successfully",
      user: updatedUser
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message || "Erreur interne" });
  }
});

export default router;

//recommandation:
router.post('/recommendation', authMiddleware, async (req: AuthRequest, res: any) => {
  try {
    const userId = req.user!.sub;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { 
        weight: true, 
        age: true, 
        sex: true, 
        num_intense_activities: true, 
        num_moderate_activities: true 
      }
    });

    const calculatedTarget = HydrationService.calculatePersonalizedGoal({
      weight: user?.weight || 0,
      age: user?.age || 30,
      gender: user?.sex === 'male' ? 'H' : 'F',
      intenseMin: user?.num_intense_activities || 0,
      moderateMin: user?.num_moderate_activities || 0,
      temp: 20 
    });

    const hydrationLogs = await prisma.hydrationLog.findMany({
      where: {
        userID: userId,
        measured_at: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      },
      orderBy: { measured_at: 'asc' }
    });

    const pythonResponse = await axios.post('http://localhost:5000/predict', {
      target_b: calculatedTarget,
      logs: hydrationLogs.map(log => ({
        time: log.measured_at,
        amount: log.weight
      }))
    });

    res.json(pythonResponse.data);

  } catch (error) {
    console.error("Recommendation Error:", error);
    res.status(500).json({ message: "无法获取推荐" });
  }
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
