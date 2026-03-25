import { PrismaClient, Prisma } from '@prisma/client';
const prisma = new PrismaClient();

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
            where: { followeeID: userId },
            include: { follower: true }
        });
    },
    getFollowing: async (userId: number) => {
        return await prisma.relationship.findMany({
            where: { followerID: userId },
            include: { followee: true }
        });
    },
    //update
    updateRelationship: async (followerId: number, followeeId: number, dataToUpdate: Prisma.RelationshipUpdateInput) => {
        return await prisma.relationship.update({
            where: { followerID_followeeID: { followerID: followerId, followeeID: followeeId } },
            data: dataToUpdate
        });
    },
    //delete
    deleteRelationship: async (followerId: number, followeeId: number) => {
        return await prisma.relationship.delete({
            where: { followerID_followeeID: { followerID: followerId, followeeID: followeeId } }
        });
    }
};