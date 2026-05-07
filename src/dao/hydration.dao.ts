import { PrismaClient, Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';

export const HydrationDAO = {
    //create
    createHydrationLog: async (logdata: Prisma.HydrationLogCreateInput, tx?: any) => {
        return await (tx || prisma).hydrationLog.create({
        data: logdata
        });
    },

    //read
    getHistoryByUserId: async (userId: number) => {
        return await prisma.hydrationLog.findMany({
        where: { userID: userId },
        orderBy: { id: 'desc' }
        });
    },

    // get hydration logs for a user in a date range
    getHistoryByDateRange: async (userId: number, startDate: Date, endDate: Date) => {
        return await prisma.hydrationLog.findMany({
        where: {
            userID: userId,
            measured_at: {
                gte: startDate,
                lte: endDate
            }
        },
        orderBy: { measured_at: 'desc' }
        });
    },

    getDailySumsByRange: async (userId: number, startDate: Date, endDate: Date) => {
        return await prisma.hydrationLog.groupBy({
            by: ['measured_at'],
            where: {
                userID: userId,
                measured_at: { gte: startDate, lte: endDate }
            },
            _sum: { weight: true }
        });
    },

    // get total water consumed by user in a date range
    getTotalConsumedByRange: async (userId: number, startDate: Date, endDate: Date) => {
        const weights = await prisma.hydrationLog.findMany({
            where: {
                userID: userId,
                measured_at: { gte: startDate, lte: endDate }
            },
            orderBy: { measured_at: 'asc' }
        });
        /**
         * Weights are stored in grams and contain load cell drifting errors,
         * so we need to apply a correction factor to get a more accurate estimate
         * of the actual water volume consumed.
         */
        let totalVolume = 0;
        let baselineWeight: number | null = null;
        let baselineTime: Date | null = null;

        /** 
         * Tuning Parameters 
         * Adjust these based on your specific load cell noise and bottle hardware.
         */
        const LIFTED_THRESHOLD = 30;    // grams. Readings below this mean the bottle is off the scale. (Assumes empty bottle > 30g)
        const MIN_DRINK_DELTA = 10;     // grams. Minimum drop in weight to count as a drink.
        const REFILL_THRESHOLD = 30;    // grams. Increase in weight to be considered a refill.
        const MAX_DRIFT_RATE = 1.0;     // grams/min. A loss faster than this is a drink; slower is evaporation/sensor drift.

        for (const record of weights) {
            const currentWeight = record.weight;
            const currentTime = record.measured_at;

            // 1. Ignore zero/tare readings entirely (bottle is removed)
            if (currentWeight < LIFTED_THRESHOLD) {
                continue;
            }

            // 2. Initialize baseline on the first valid resting weight
            if (baselineWeight === null || baselineTime === null) {
                baselineWeight = currentWeight;
                baselineTime = currentTime;
                continue;
            }

            const weightDelta = baselineWeight - currentWeight; // Positive = weight lost
            const timeDeltaMins = (currentTime.getTime() - baselineTime.getTime()) / 60000;

            // 3. Evaluate the state change
            if (weightDelta >= MIN_DRINK_DELTA) {
                // Weight dropped significantly. Check if it's a drink or slow sensor drift.
                const rateOfLoss = weightDelta / timeDeltaMins;

                if (rateOfLoss > MAX_DRIFT_RATE) {
                    // It was a valid drink!
                    totalVolume += weightDelta;
                }
                
                // Whether it was a drink or slow drift, reset baseline to the new lower weight
                baselineWeight = currentWeight;
                baselineTime = currentTime;

            } else if (weightDelta <= -REFILL_THRESHOLD) {
                // Weight increased significantly -> Refill event
                baselineWeight = currentWeight;
                baselineTime = currentTime;

            } else if (weightDelta < 0 && weightDelta > -REFILL_THRESHOLD) {
                // Minor weight increase (e.g., placing the cap back on, sensor noise).
                // Update the baseline UP to prevent accidentally counting it as consumption later.
                baselineWeight = currentWeight;
                baselineTime = currentTime;
                
            } 
            // Note: If (0 <= weightDelta < MIN_DRINK_DELTA), we do NOTHING.
            // We do not update the baseline. This allows tiny sips (or consecutive 2g readings) 
            // to accumulate against the original baseline until they cross the MIN_DRINK_DELTA threshold.
        }

        return totalVolume;        
    },

    //update
    updateHydrationLog: async (logId: number, dataToUpdate: Prisma.HydrationLogUpdateInput) => {
        return await prisma.hydrationLog.update({
            where: { id: logId },
            data: dataToUpdate
        });
    },

    //delete
    deleteLog: async (logId: number) => {
    return await prisma.hydrationLog.delete({
      where: {
        id: logId
      }
    });
    },

    async createMeasure(data: { weight: number; userID: number; source: string; measured_at?: Date }) {
        return await prisma.hydrationLog.create({
            data: {
                weight: data.weight,
                userID: data.userID,
                source: data.source,
                measured_at: data.measured_at || new Date(),
            }
        });
    },
    
};