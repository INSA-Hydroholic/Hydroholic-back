import { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

export const GoalTypeDAO = {
    createGoalType: async (data: Prisma.GoalTypeCreateInput) => {
        return await prisma.goalType.create({ data });
    },
    getAllGoalTypes: async () => {
        return await prisma.goalType.findMany();
    },
    deleteGoalType: async (id: number) => {
        return await prisma.goalType.delete({ where: { id } });
    }
};