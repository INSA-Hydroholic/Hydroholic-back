import { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

export const DeviceDAO = {

    async register(mac: string, organizationId?: number) {
    return await prisma.device.upsert({
        where: { macAddress: mac },
        update: { organizationId: organizationId },
        create: { macAddress: mac, organizationId: organizationId }
    });
    },


    async findUserByMac(mac: string) {
        return await prisma.device.findUnique({
            where: { macAddress: mac },
            select: { user: { select: { id: true, esp32 : {select : { macAddress: true } } } } }
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
        lastMeasuredWeight: level,
        payloadSentAt: timestamp || new Date()
        }
    });
    },

    async findDevicesByEstablishment(establishmentID: number) {
        return await prisma.device.findMany({
            where: { organizationId: establishmentID },
            include: { user: { select: { id: true, username: true } } }
        });
    },

    async bindUserToDevice(userId, deviceId){
        const device = await prisma.device.findUnique({
        where: { macAddress: deviceId }
        });

        if (!device) throw new Error("Device not found");

        return await prisma.user.update({
            where: { id: Number(userId) },
            data: {
                esp32Id: device.id
            }
        });
    },

    async unbindUserFromDevice(userId, deviceId) {
        const device = await prisma.device.findUnique({
            where: { macAddress: deviceId }
        });
        
        if (!device) throw new Error("Device not found");

        return await prisma.user.update({
            where: { id: Number(userId) }, 
            data: {
                esp32Id: null
            }
        });
    },
};