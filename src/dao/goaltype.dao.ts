import { PrismaClient, Prisma } from '@prisma/client';
const prisma = new PrismaClient();

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