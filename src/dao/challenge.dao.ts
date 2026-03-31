import { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

export const ChallengeDAO = {
    //create
    createChallenge: async (challengeData: Prisma.ChallengeCreateInput) => {
        return await prisma.challenge.create({
            data: challengeData
        });
    },
    //read
    getChallengesByUser: async (userId: number) => {
        return await prisma.challenge.findMany({
            where: {
                participants: {
                    some: {
                        userID: userId 
                    }
                }
            }
        });
    },
    //update
    updateChallenge: async (challengeId: number, dataToUpdate: Prisma.ChallengeUpdateInput) => {
        return await prisma.challenge.update({
            where: { id: challengeId },
            data: dataToUpdate
        });
    },
    //delete
    deleteChallenge: async (challengeId: number) => {
        const deleteParticipants = prisma.challengeParticipant.deleteMany({
            where: { challengeID: challengeId }
        });

        const deleteTheChallenge = prisma.challenge.delete({
            where: { id: challengeId }
        });

        return await prisma.$transaction([
            deleteParticipants, 
            deleteTheChallenge
        ]);
    }

};