import { prisma } from '../lib/prisma';
import { HydrationDAO } from '../dao/hydration.dao';
import { UserDAO } from '../dao/user.dao';
type logParams = {
  userId: number,
  weight: number,
  source?: string,
  measured_at?: string
};

const STABLE_THRESHOLD = 5;
const DRINK_MAX_THRESHOLD = 500;

export const HydrationService = {
  async logWater(logParams: { userId: number; weight: number; source?: string }) {
    const { userId, weight, source } = logParams;

    // 1. Fetch the most recent record as a comparison baseline
    const logs = await HydrationDAO.getHistoryByUserId(userId);
    const lastLog = logs[0];

    // --- Audit Phase ---
    if (weight < 0) {
      console.warn(`[Audit] Abnormal weight: ${weight}g. Sending calibration warning.`);
      return null; 
    }
    
    // If weight is 0, the cup has been removed and not yet replaced; entering "pending" state
    if (weight === 0) {
      console.log(`[State] Cup removed. Waiting for replacement...`);
      return await HydrationDAO.createHydrationLog({
        user: { connect: { id: userId } },
        weight: 0,
        source: source || 'hydrobase'
      });
    }

    // --- State Determination & Calculation Phase ---
    let drinkDelta = 0;

    if (lastLog) {
      // Stable value detected (the difference between current and previous records is within a reasonable range, 
      // indicating the user has completed the "put down" action).
      // We look for the last non-zero stable value before the cup was picked up.
      const lastStableLog = logs.find(l => l.weight > STABLE_THRESHOLD);
      
      if (lastStableLog && lastStableLog.weight > weight + STABLE_THRESHOLD) {
        // Weight decreased and re-stabilized: calculate the delta
        drinkDelta = lastStableLog.weight - weight;
        
        // Audit: Validate the delta value
        if (drinkDelta > DRINK_MAX_THRESHOLD) {
          console.warn(`[Audit] Abnormal water intake detected: ${drinkDelta}ml. Possible spill or sensor error.`);
          drinkDelta = 0; // Audit failed
        }
      } else if (lastStableLog && weight > lastStableLog.weight + STABLE_THRESHOLD) {
        // Significant weight increase: identified as "Refill", does not count toward hydration progress
        console.log(`[State] Refill detected: +${weight - lastStableLog.weight}g`);
        drinkDelta = 0;
      }
    }

    // 2. Store new record and initiate transaction to update challenge progress (even if audit fails, we still want to log the event)
    return await prisma.$transaction(async (tx) => {
      const newLog = await HydrationDAO.createHydrationLog({
        user: { connect: { id: userId } },
        weight: weight,
        source: source || 'app'
      }, tx);

      // Only update challenge progress if the audit passes and a valid delta is calculated
      if (drinkDelta > 0) {
        console.log(`[Success] Confirmed drinking: ${drinkDelta}ml`);
        await tx.challengeParticipant.updateMany({
          where: { userID: userId, status: 'active' },
          data: { progress_ml: { increment: Math.round(drinkDelta) } }
        });
      }

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
      log._sum?.weight || 0
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