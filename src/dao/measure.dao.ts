import { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

export const MeasureDAO = {
    async createMeasure(data: { weight: number; userId: number; source: string; date?: Date }) {
        return await prisma.hydrationLog.create({
            data: {
                weight: data.weight,
                userID: data.userId,
                source: data.source,
                measured_at: data.date || new Date(),
            }
        });
    },

    async findUserByMac(mac: string) {
        return await prisma.device.findUnique({
            where: { macAddress: mac },
            select: { user: { select: { id: true } } }
        });
    }
}