import { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

export const DeviceDAO = {

    async register(mac: string) {
    return await prisma.device.upsert({
        where: { macAddress: mac },
        update: {},
        create: { macAddress: mac }
    });
    },


    async findUserByMac(mac: string) {
        return await prisma.device.findUnique({
            where: { macAddress: mac },
            select: { user: { select: { id: true } } }
        });
    },


    async updateBattery(mac: string, level: number, timestamp?: Date) {
    return await prisma.device.update({
        where: { macAddress: mac },
        data: {
        batteryLevel: level,
        batteryMeasuredAt: timestamp || new Date()
        }
    });
    },

    async updateWeight(mac: string, level: number, timestamp?: Date) {
    return await prisma.device.update({
        where: { macAddress: mac },
        data: {
        measuredWeight: level,
        weightMeasuredAt: timestamp || new Date()
        }
    });
    },

    async findDevicesByEstablishment(establishmentID: number) {
        return await prisma.device.findMany({
            where: { organizationId: establishmentID },
            include: { user: { select: { id: true, username: true } } }
        });
    }
};