import { prisma } from '../lib/prisma';
import { HydrationDAO } from '../dao/hydration.dao';
import { UserDAO } from '../dao/user.dao';

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
  },
  async getHistory(userId: number, days: number) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - days);

    const dbLogs = await HydrationDAO.getDailySumsByRange(userId, startDate, endDate);

    // hypothese: data like "YYYY-MM-DD"
    const logMap = new Map(dbLogs.map(log => [
      log.measured_at.toISOString().split('T')[0], 
      log._sum.volume_ml || 0
    ]));

    const history = [];
    const currentUser = await UserDAO.getUserById(userId);

    for (let i = 0; i <= days; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];

      history.push({
        date: dateStr,
        total_ml: logMap.get(dateStr) || 0,
        goal_ml: currentUser?.daily_goal || 2000
      });
    }

    return history;
  }
  
};