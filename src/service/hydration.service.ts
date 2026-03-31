import { prisma } from '../lib/prisma';
import { HydrationDAO } from '../dao/hydration.dao';

export const HydrationService = {
  async logWater(userId: number, amount: number, source: string) {
    return await prisma.$transaction(async (tx) => {
      
      const newLog = await HydrationDAO.createHydrationLog({
        user: { connect: { id: userId } },
        volume_ml: amount,
        source: source,
      }, tx);

      await tx.challengeParticipant.updateMany({
        where: { userID: userId, status: 'active' },
        data: { progress_ml: { increment: amount } }
      });

      return newLog;
    });
  }
};