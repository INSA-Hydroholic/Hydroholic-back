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
        const minRateDelta = 5; // Minimum weight change (per minute) in grams to consider as actual water intake - derived from empirical observations of the device's noise level
        const maxRateDelta = 300; // Drinking more than 300g (300ml) per minute is unlikely, so we can ignore such spikes as noise or refills.
        let totalVolume = 0;
        for (let i = 1; i < weights.length; i++) {
            let delta = weights[i].weight - weights[i - 1].weight;
            if (delta > 0) { continue; }  // Weight decreases when water is consumed, so we only consider negative deltas. Positive deltas are likely due to noise or refills.
            delta = -delta; // Convert to positive volume change
            const timeDelta = (weights[i].measured_at.getTime() - weights[i - 1].measured_at.getTime()) / 60000; // time difference in minutes
            const rate = delta / timeDelta;
            if (minRateDelta < rate && rate < maxRateDelta) {
                totalVolume += delta;
            }
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
    }
};