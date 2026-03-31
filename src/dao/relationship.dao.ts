import { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

export const RelationshipDAO = {
    //create
    createRelationship: async (relationshipData: Prisma.RelationshipCreateInput) => {
        return await prisma.relationship.create({
            data: relationshipData
        });
    },
    //read
    getFollowers: async (userId: number) => {
        return await prisma.relationship.findMany({
            where: { receiverID: userId },
            include: { requester: true }
        });
    },
    getFollowing: async (userId: number) => {
        return await prisma.relationship.findMany({
            where: { requesterID: userId },
            include: { receiver: true }
        });
    },
    //update
    updateRelationship: async (requesterId: number, receiverId: number, dataToUpdate: Prisma.RelationshipUpdateInput) => {
        return await prisma.relationship.update({
            where: { requesterID_receiverID: { requesterID: requesterId, receiverID: receiverId } },
            data: dataToUpdate
        });
    },
    //delete
    deleteRelationship: async (requesterId: number, receiverId: number) => {
        return await prisma.relationship.delete({
where: { requesterID_receiverID: { requesterID: requesterId, receiverID: receiverId } }
        });
    }
};