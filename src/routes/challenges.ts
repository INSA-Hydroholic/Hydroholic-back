import { Response } from 'express';
import { Router } from 'express';
import { ChallengeDAO } from '../dao/challenge.dao';
import { ChallengeParticipantDAO } from '../dao/participant.dao';
import { prisma } from '../lib/prisma';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';

const router = Router();

router.use(authMiddleware);
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const challenges = await prisma.challenge.findMany({
      include: { participants: true }
    });
    res.json(challenges);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

router.get('/:challengeId', async (req: AuthRequest, res: Response) => {
  try {
    const challengeId = parseInt(req.params.challengeId);
    const challenge = await prisma.challenge.findUnique({
      where: { id: challengeId },
      include: { participants: true }
    });
    
    if (!challenge) return res.status(404).json({ message: 'Challenge non trouvé' });
    res.json(challenge);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { name, type, objective, description } = req.body;
    
    const creatorId = req.user!.sub; 
    
    const newChallenge = await ChallengeDAO.createChallenge({
      title: name,
      description: description || null,
      status: 'active',
      challenge_type: type || 'global',
      objective_ml: parseInt(objective) || 0,
      start_date: new Date(),
      end_date: new Date(new Date().getTime() + 7 * 24 * 60 * 60 * 1000),
      creator: { connect: { id: creatorId } }
    });

    res.status(201).json(newChallenge);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur de création' });
  }
});

router.post('/:challengeId/join', async (req: AuthRequest, res: Response) => {
  try {
    const challengeId = parseInt(req.params.challengeId);

    const userId = req.user!.sub;

    const participation = await ChallengeParticipantDAO.createParticipant({
      challenge: { connect: { id: challengeId } },
      user: { connect: { id: userId } },
      status: 'active'
    });

    res.json({ message: 'Rejoint avec succès', participation });
  } catch (error) {
    res.status(500).json({ message: 'Erreur lors de la jonction' });
  }
});

export default router;