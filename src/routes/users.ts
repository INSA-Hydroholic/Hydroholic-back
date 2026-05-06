import { Router } from 'express';
import { UserDAO } from '../dao/user.dao';
import { HydrationDAO } from '../dao/hydration.dao';
import { authMiddleware } from '../middlewares/auth.middleware';
import { prisma } from '../lib/prisma';
import { HydrationService } from '../service/hydration.service';
import alerts from './alerts';

const router = Router();


// get all users
router.get('/', async (req, res) => {
  try {

    const { filter, organizationId } = req.query;
    const where: any = {};
    if (filter) where.role = filter;
    if (organizationId) where.organizationId = parseInt(organizationId as string);


    
    if(filter === 'RESIDENTS'){

    }

    const users = await prisma.user.findMany({
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

// get all users
router.get('/', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
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

// endpoint used to manually add water and for the BLE device
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
    res.json({ message: 'Successfully added hydration log', data: newLog });

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

// calculate the goal for a given user
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

// add a nurse
// can only be called by an admin of the same organization
router.post('/addUser/nurse', authMiddleware, async (req: any, res: any) => {
  try {
    const { username, email, password, first_name, surname } = req.body;

    // We retrieve the user ID from the JWT token
    const requestingUserID = req.user?.sub;
    if (!requestingUserID) return res.status(401).json({ message: "Unauthorized request" });

    // Get the user from DB and check if they have the required permissions
    const user = await UserDAO.getUserById(requestingUserID);

    if (!user || user.role !== "ADMIN" && user.role !== "STAFF") {
      return res.status(403).json({ message: "Access denied" });
    }

    // Create the new nurse user
    const newNurse = await UserDAO.createUser({
      username,
      email,
      name: first_name,
      surname,
      password_hash: password,
      role: "NURSE",
      organizationId: user.organizationId
    });

    res.status(201).json({ message: "Nurse added successfully", user: newNurse });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error adding nurse" });
  }
});

// add a resident
// can only be called by an admin or nurse of the same organization
router.post('/addUser/resident', authMiddleware, async (req: any, res: any) => {
  try {
    const { username, email, password, first_name, surname } = req.body;

    // We retrieve the user ID from the JWT token
    const requestingUserID = req.user?.sub;
    if (!requestingUserID) return res.status(401).json({ message: "Unauthorized request" });

    // Check if the user is an admin or nurse of the same organization
    const user = await UserDAO.getUserById(requestingUserID);
    if (!user || (user.role !== "ADMIN" && user.role !== "NURSE" && user.role !== "STAFF")) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Create the new resident user
    const newResident = await UserDAO.createUser({
      username,
      email,
      password_hash: password,
      name: first_name,
      surname,
      role: "RESIDENT",
      organizationId: user.organizationId
    });

    res.status(201).json({ message: "Resident added successfully", user: newResident });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error adding resident" });
  }
});


// remove a nurse or resident
// can only be called by an admin of the same organization
router.delete('/deleteUser/:userId', authMiddleware, async (req: any, res: any) => {
  try {
    // We retrieve the user ID from the JWT token
    const requestingUserID = req.user?.sub;
    if (!requestingUserID) return res.status(401).json({ message: "Unauthorized request" });


    const requestingUser = await UserDAO.getUserById(requestingUserID);
    const userToDelete = await UserDAO.getUserById(parseInt(req.params.userId));

    // Check if the user is an admin
    if (!requestingUser || requestingUser.role !== "ADMIN") {
      return res.status(403).json({ message: "Access denied" });
    }

    if (userToDelete?.organizationId !== requestingUser.organizationId) {
      return res.status(403).json({ message: "You can only delete users from your organization" });
    }

    // Delete requested user
    await UserDAO.deleteUser(req.params.userId);

    res.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error deleting user" });
  }
});

const DRINK_THRESHOLD = 5; // ml minimum expected for a sip
router.get('/:userId/alerts', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const now = new Date();

    const { evaluated_time } = req.query;
    const startTime = new Date();
    if (evaluated_time) {
      // Offset current time by the evaluated_time (in minutes) to get the start time for the analysis
      startTime.setMinutes(now.getMinutes() - parseInt(evaluated_time as string));
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, surname: true, daily_goal: true }
    });

    if (!user) return res.status(404).json({ message: 'User not found' });

    const consumed = await HydrationDAO.getTotalConsumedByRange(userId, startTime, now);

    const shouldBeep = consumed < DRINK_THRESHOLD;

    res.json({ shouldBeep });

  } catch (error) {
    console.error('Alert analysis error:', error);
    res.status(500).json({ message: `Server error: ${error}` });
  }
});

export default router;