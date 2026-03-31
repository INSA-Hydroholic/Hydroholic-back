import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

export const HydrationDAO = {
    //create
    createHydrationLog: async (logdata: Prisma.HydrationLogCreateInput) => {
        return await prisma.hydrationLog.create({
        data: logdata
        });
    },
    //read
    getHistoryByUserId: async (userId: number) => {
        return await prisma.hydrationLog.findMany({
        where: { userID: userId },
        orderBy: { measured_at: 'desc' }
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
    //update
    updateHydrationLog: async (userId: number, timeString: string, dataToUpdate: Prisma.HydrationLogUpdateInput) => {
        return await prisma.hydrationLog.update({
        where: {
            userID_measured_at: {
                userID: userId,
                measured_at: new Date(timeString)
            }
        },
        data: dataToUpdate
        });
    },

    //delete
    deleteLog: async (userId: number, timeString: string) => {
    return await prisma.hydrationLog.delete({
      where: {
        userID_measured_at: {
          userID: userId,
          measured_at: new Date(timeString)
        }
      }
    });
  }
};