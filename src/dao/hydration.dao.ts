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
        let valid_weights = [];
        for (let i = 1; i < weights.length; i++) {
            let delta = weights[i].weight - weights[i - 1].weight;
            if (delta > 0) {  // Weight decreases when water is consumed, so we only consider negative deltas. Positive deltas are likely due to noise or refills.
                // If the rise goes back to a value close to i-2, we save it as a valid weight since it's likely the bottle that was put back after a drink, otherwise we ignore it as noise or a refill event.
                const drink_delta = Math.abs(weights[i].weight - weights[i - 2].weight);
                if (i > 1 && drink_delta < minRateDelta) {
                    valid_weights.push(weights[i]);
                } 
            } 

            delta = -delta; // Convert to positive volume change
            const timeDelta = (weights[i].measured_at.getTime() - weights[i - 1].measured_at.getTime()) / 60000; // time difference in minutes
            const rate = delta / timeDelta;
            if (rate < minRateDelta) {
                // Average the two weights to reduce noise for very small changes that are likely due to drifting rather than actual consumption
                let avgWeight = (weights[i].weight + weights[i - 1].weight) / 2;
                let avgTime = new Date((weights[i].measured_at.getTime() + weights[i - 1].measured_at.getTime()) / 2);
                valid_weights.push({ weight: avgWeight, measured_at: avgTime });
            } else if (rate > maxRateDelta) {
                // Large decreases in weight are considered as a drink event, so we ignore the latter weight
                valid_weights.push(weights[i-1]);
            } else {
                // For reasonable rates of change, we save both readings
                valid_weights.push(weights[i-1]);
                valid_weights.push(weights[i]);
            }
        }

        for (let i = 1; i < valid_weights.length; i++) {
            let delta = valid_weights[i].weight - valid_weights[i - 1].weight;
            if (delta > 0) { continue; }  // Weight decreases when water is consumed, so we only consider negative deltas. Positive deltas are likely due to noise or refills.
            delta = -delta; // Convert to positive volume change
            const timeDelta = (valid_weights[i].measured_at.getTime() - valid_weights[i - 1].measured_at.getTime()) / 60000; // time difference in minutes
            const rate = delta / timeDelta;
            if (minRateDelta < rate && rate < maxRateDelta) {
                console.log(`Valid drink event detected: ${delta}g from ${valid_weights[i - 1].measured_at} to ${valid_weights[i].measured_at} (rate: ${rate.toFixed(2)} g/min)`);
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