import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { ChallengeDAO } from '../dao/challenge.dao';
import { ChallengeParticipantDAO } from '../dao/participant.dao';

const router = Router();
const prisma = new PrismaClient();

// get all challenges
router.get('/', async (req, res) => {
  try {
    const challenges = await prisma.challenge.findMany({
      include: { participants: true }
    });
    res.json(challenges);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// get challenge by id
router.get('/:challengeId', async (req, res) => {
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

// create a new challenge
router.post('/', async (req, res) => {
  try {
    const { name, type, objective, duration, creatorId } = req.body;
    
    const newChallenge = await ChallengeDAO.createChallenge({
      title: name,
      status: 'active',
      start_date: new Date(),
      end_date: new Date(new Date().getTime() + 7 * 24 * 60 * 60 * 1000),
      creator: { connect: { id: parseInt(creatorId) } }
    });

    res.status(201).json(newChallenge);
  } catch (error) {
    res.status(500).json({ message: 'Erreur de création', error });
  }
});

// join a challenge
router.post('/:challengeId/join', async (req, res) => {
  try {
    const challengeId = parseInt(req.params.challengeId);
    const userId = parseInt(req.body.userId);

    if (!userId) return res.status(400).json({ message: 'userId requis' });

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