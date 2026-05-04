import { prisma } from '../lib/prisma';
import { HydrationDAO } from '../dao/hydration.dao';
import { UserDAO } from '../dao/user.dao';
import axios from 'axios';

type logParams = {
  userId: number,
  weight: number,
  source?: string,
  measured_at?: string
};

const STABLE_THRESHOLD = 5;
const DRINK_MAX_THRESHOLD = 500;
const CONFIG = {
  ALPHA: 0.1,              // Sensitivity learning rate (controls magnitude of a single fluctuation)
  BETA: 0.02,              // Decay step per unrecorded recommendation
  MIN_SENSITIVITY: 0.5,    // Lower bound for sensitivity (min 50% of predicted amount)
  MAX_SENSITIVITY: 1.5,    // Upper bound for sensitivity (max 150% of predicted amount)
  MIN_DAILY_COEFF: 0.6,    // Lower bound for daily goal (prevents dehydration due to habit decline)
  MAX_DAILY_COEFF: 1.2,    // Upper bound for daily goal
  GAMMA: 0.3               // ratio of short-term sensitivity deviation to be absorbed into long-term daily coefficient (prevents overfitting to short-term fluctuations)
};

/**
 * 1. Update hydration sensitivity (called after each recommendation cycle or user log)
 * 
 * @param userId User ID
 * @param expectedAmount Predicted hourly water intake (e)
 * @param actualAmount Actual hourly water intake (r). Pass null if no record exists.
 * @param responseTimeMs Time elapsed between recommendation and log (ms). Faster response indicates higher engagement.
 */
export async function updateHydrationSensitivity(
  userId: number,
  expectedAmount: number,
  actualAmount: number | null,
  responseTimeMs: number | null
): Promise<void> {
  // User offline or missed check-in -> Freeze sensitivity and return
  if (actualAmount === null || actualAmount === undefined) {
    console.log(`[Hydration] User ${userId} is offline/missed. Sensitivity frozen.`);
    return; 
  }

  // Prevent division by zero
  const safeExpected = expectedAmount > 0 ? expectedAmount : 1;
  
  // Calculate deviation ratio
  const ratio = actualAmount / safeExpected; 

  // Calculate response engagement score (between 0 and 1. Full score 1.0 for responses within 30 mins/1800000ms)
  let responseScore = 1.0;
  if (responseTimeMs !== null) {
    const maxResponseTime = 1800000; // 30 mins
    responseScore = Math.max(0.1, 1 - (responseTimeMs / maxResponseTime)); 
  }

  // Calculate deviation amount: positive if drinking more, negative if drinking less, weighted by engagement
  const deviation = (ratio - 1) * responseScore;

  // Retrieve current user sensitivity
  const user = await UserDAO.getUserById(userId); // Depends on your DAO implementation
  let currentSensitivity = user?.hydrationSensitivity || 1.0;

  // Update formula: current sensitivity + (learning rate * deviation)
  let newSensitivity = currentSensitivity + (CONFIG.ALPHA * deviation);

  // Clamp values (to prevent sudden large spikes/drops)
  newSensitivity = Math.min(Math.max(newSensitivity, CONFIG.MIN_SENSITIVITY), CONFIG.MAX_SENSITIVITY);

  // Persist update to database
  await UserDAO.updateUser(userId, { hydrationSensitivity: newSensitivity });
  console.log(`[Hydration] User ${userId} sensitivity updated to ${newSensitivity.toFixed(2)}`);
}
/**
 * 2. Daily Hydration Coefficient Settlement (Accounts for Hidden Intake + Habits)
 * 
 * @param userId User ID
 * @param missedCount Number of missed (unlogged) recommendations from yesterday
 */
export async function updateDailyCoefficient(
  userId: number,
  missedCount: number
): Promise<void> {
  const user = await UserDAO.getUserById(userId); 
  const currentCoeff = user?.dailyHydrationCoefficient || 1.0;
  const currentSensitivity = user?.hydrationSensitivity || 1.0;

  let newCoeff = currentCoeff;

  // Evaluate hidden water intake based on Sensitivity
  const sensitivityOffset = currentSensitivity - 1.0;

  // Incorporate short-term sensitivity deviations into the long-term daily coefficient at a specific ratio (GAMMA)
  newCoeff = currentCoeff + (CONFIG.GAMMA * sensitivityOffset);

  // Failure to log suggests the current recommendation rhythm may not align with user habits; apply a minor adjustment
  if (missedCount > 0) {
    newCoeff -= (CONFIG.BETA * missedCount);
  } else {
    newCoeff += 0.01; // Small reward for full attendance to encourage consistency
  }

  newCoeff = Math.min(Math.max(newCoeff, CONFIG.MIN_DAILY_COEFF), CONFIG.MAX_DAILY_COEFF);

  const resetSensitivity = currentSensitivity + (1.0 - currentSensitivity) * 0.5;

  // Update both daily coefficient and reset sensitivity to prevent long-term drift
  await UserDAO.updateUser(userId, {
    dailyHydrationCoefficient: newCoeff,
    hydrationSensitivity: resetSensitivity
  });

  console.log(`[Hydration] User ${userId} daily Coeff settled at ${newCoeff.toFixed(2)}, Sensitivity reset to ${resetSensitivity.toFixed(2)}`);
}

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
  },

  calculatePersonalizedGoal: (data: Partial<{
    weight: number,
    age: number,
    gender: 'H' | 'F',
    intenseMin: number,
    moderateMin: number,
    temp: number,
    isHot: boolean
  }>) => {
    // 1. Si l'objet est vide ou inexistant, on retourne le défaut de 2000ml
    if (!data || Object.keys(data).length === 0) {
      return 2000;
    }

    const weight = data.weight;
    const age = data.age ?? 30; 
    const gender = data.gender ?? 'F'; 
    const intenseMin = data.intenseMin ?? 0;
    const moderateMin = data.moderateMin ?? 0;
    const temp = data.temp ?? 20;

    let base = 0;

    if (!weight) {
      base = 2000;
    } else {
      if (age < 55) {
        base = weight * 35;
      } else if (age <= 65) {
        base = weight * 30;
      } else {
        base = weight * 25;
      }

      if (gender === 'H') {
        base *= 1.1;
      }
    }

    const intenseBonus = ((intenseMin / 7) / 60) * 600;
    const moderateBonus = ((moderateMin / 7) / 60) * 400;
    let envBonus = 0;
    if (temp >= 30) {
      envBonus = 1000;
    } else if (temp >= 20) {
      envBonus = 500;
    }

    return Math.round(base + intenseBonus + moderateBonus + envBonus);
  }
  
};

export const WeatherService = {
  getTemperatureByCity: async (city: string): Promise<number> => {
    const API_KEY = process.env.WEATHER_API_KEY;
    console.log("Ma clé API est :", API_KEY ? "Chargée" : "Absente");
    const url = `http://api.weatherapi.com/v1/current.json?key=${API_KEY}&q=${city}&aqi=no`;
    
    try {
      const response = await axios.get(url);
      return response.data.current.temp_c; // Retourne la température en Celsius
    } catch (error) {
      console.error("Erreur météo:", error);
      return 20; // Valeur par défaut en cas d'erreur
    }
  }
};