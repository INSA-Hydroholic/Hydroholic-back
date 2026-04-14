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
            _sum: { volume_ml: true }
        });
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