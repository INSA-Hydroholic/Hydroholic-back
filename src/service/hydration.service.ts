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