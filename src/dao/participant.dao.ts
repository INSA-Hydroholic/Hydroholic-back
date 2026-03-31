import { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

export const ChallengeParticipantDAO = {
    //create
    createParticipant: async (participantData: Prisma.ChallengeParticipantCreateInput) => {
        return await prisma.challengeParticipant.create({
            data: participantData
        });
    },
    //read
    getParticipantsByChallenge: async (challengeId: number) => {
        return await prisma.challengeParticipant.findMany({
            where: {
                challengeID: challengeId
            }
        });
    },
    //update
    updateParticipant: async (participantId: number, dataToUpdate: Prisma.ChallengeParticipantUpdateInput) => {
        return await prisma.challengeParticipant.update({
            where: { id: participantId },
            data: dataToUpdate
        });
    },
    //delete
    deleteParticipant: async (participantId: number) => {
        return await prisma.challengeParticipant.delete({
            where: { id: participantId }
        });
    }
};