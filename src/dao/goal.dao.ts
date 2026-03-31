import { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

export const GoalDAO = {
    createGoal: async (data: Prisma.GoalCreateInput) => {
        return await prisma.goal.create({ data });
    },
    getGoalsByUser: async (userId: number) => {
        return await prisma.goal.findMany({
            where: { userID: userId },
            include: { goalType: true }
        });
    },
    updateGoal: async (id: number, data: Prisma.GoalUpdateInput) => {
        return await prisma.goal.update({ where: { id }, data });
    },
    deleteGoal: async (id: number) => {
        return await prisma.goal.delete({ where: { id } });
    }
};