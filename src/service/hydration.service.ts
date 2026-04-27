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

export const HydrationService = {
  async logWater(logParams: logParams) {
    return await prisma.$transaction(async (tx) => {
      
      const newLog = await HydrationDAO.createHydrationLog({
        user: { connect: { id: logParams.userId } },
        weight: logParams.weight,
        source: logParams.source,
        measured_at: logParams.measured_at
      }, tx);

      // TODO - this logic must be fixed to use proper calculation of volume progress
      await tx.challengeParticipant.updateMany({
        where: { userID: logParams.userId, status: 'active' },
        data: { progress_ml: { increment: logParams.weight } }
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