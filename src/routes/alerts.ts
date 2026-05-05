import { Router } from 'express';
import { prisma } from '../lib/prisma';

const router = Router();

// GET /api/alerts — all unresolved alerts
router.get('/', async (req, res) => {
  try {
    const alerts = await prisma.alertLog.findMany({
      where: { isResolved: false },
      orderBy: { created_at: 'desc' },
    });
    res.json(alerts);
  } catch (error) {
    res.status(500).json({ message: `Server error: ${error}` });
  }
});

// PATCH /api/alerts/:id/resolve — mark an alert as resolved
router.patch('/:id/resolve', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const alert = await prisma.alertLog.update({
      where: { id },
      data: { isResolved: true },
    });
    res.json(alert);
  } catch (error) {
    res.status(500).json({ message: `Server error: ${error}` });
  }
});


// Calculate if alerts exist for a given user and sends them directly (no storing in DataBase)
router.post('/calculateAlerts', async (req, res) => {
  try {
    const { userId } = req.body;
    const alerts = await prisma.alertLog.findMany({
      where: { userId, isResolved: false },
      orderBy: { created_at: 'desc' },
    });
    res.json(alerts);
  } catch (error) {
    res.status(500).json({ message: `Server error: ${error}` });
  }
});

export default router;