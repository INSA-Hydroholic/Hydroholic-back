import { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

export const UserDAO = {
  
    //create
    createUser: async (userData: Prisma.UserCreateInput) => {
        return await prisma.user.create({
        data: userData
        });
    },

    //read
    getByInfo: async (filterCondition: Prisma.UserWhereInput) => {
        return await prisma.user.findMany({
        where: filterCondition
        });
    },

    getUserById: async (userId: number) => {
        return await prisma.user.findUnique({
        where: { id: userId }
        });
    },

    //update
    updateUser: async (userId: number, dataToUpdate: Prisma.UserUpdateInput) => {
        return await prisma.user.update({
        where: { id: userId },
        data: dataToUpdate
        });
    },

    //delete
    deleteUser: async (userId: number) => {
        return await prisma.user.delete({
        where: { id: userId }
        });
    },

    updateDailyGoal: async (userId: number, newGoal: number) => {
        return await prisma.user.update({
        where: { id: userId },
        data: { daily_goal: Math.round(newGoal) } 
        });
    }

    
};