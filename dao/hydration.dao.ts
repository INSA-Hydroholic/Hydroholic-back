import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const HydrationDAO = {
  createLog: async (userId: number, weight: number) => {
    return await prisma.hydrationLog.create({
      data: {
        userID: userId,
        weight_value: weight,
        measured_at: new Date()
      }
    });
  },

  getHistoryByUserId: async (userId: number) => {
    return await prisma.hydrationLog.findMany({
      where: { userID: userId },
      orderBy: { measured_at: 'desc' }
    });
  }
};