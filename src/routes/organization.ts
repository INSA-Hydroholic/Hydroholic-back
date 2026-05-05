import { Router } from 'express';
import { ChallengeDAO } from '../dao/challenge.dao';
import { ChallengeParticipantDAO } from '../dao/participant.dao';
import { prisma } from '../lib/prisma';

import { HydrationDAO } from '../dao/hydration.dao';

const router = Router();

const DRINK_THRESHOLD_3H = 50; // ml minimum expected in last 3h
const DRINK_THRESHOLD_6H = 50; // ml minimum expected in last 6h

// Calculate if alerts exist for a given user and sends them directly (no storing in DataBase)
// 4 types of alerts :
// - Not drinking for more than 3 hours (Yellow)
// - Not drinking for more than 6 hours (Red)
// - Not drinking a third of objective at 12h (Yellow)
// - Not drinking half of objective at 16h (Yellow)
router.get('/:establishmentId/alerts', async (req, res) => {
try {
    const now = new Date();
    const startOfDay = new Date(now.setHours(0, 0, 0, 0));
    const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    const hour = new Date().getHours();

    const users = await prisma.user.findMany({
        where: {
            esp32Id: { not: null },
            organizationId: parseInt(req.params.establishmentId)
        },
        select: {id: true, surname: true, daily_goal: true,}
    });

    const alertsToCreate = [];
    
    // For each user, fetch consumption in said daytimes
    for (const user of users) {
        const [consumed3h, consumed6h, consumedToday] = await Promise.all([
            HydrationDAO.getTotalConsumedByRange(user.id, threeHoursAgo, now),
            HydrationDAO.getTotalConsumedByRange(user.id, sixHoursAgo, now),
            HydrationDAO.getTotalConsumedByRange(user.id, startOfDay, now)
        ]);

      // Rule 1 - Below threshold in last 6h
        if (consumed6h < DRINK_THRESHOLD_6H) {
        alertsToCreate.push({
            userId: user.id,
            severity: 'RED',
            message: `${user.surname} hasn't drunk in the last 6 hours — intervention recommended.`
        });
        // Rule 2 - Nothing drunk in last 3h
        } else if (consumed3h < DRINK_THRESHOLD_3H) {
        alertsToCreate.push({
            userId: user.id,
            severity: 'YELLOW',
            message: `${user.surname} hasn't drunk in the last 3 hours — monitoring recommended.`
        });
        }

        // Rule 3 - past noon, less than 1/3 of daily goal
        if (hour >= 12 && consumedToday < user.daily_goal / 3) {
        alertsToCreate.push({
            userId: user.id,
            severity: 'YELLOW',
            message: `${user.surname} — is below 1/3 of daily goal, only ${Math.round(consumedToday)}ml consumed.`
        });
        }

        // Rule 4 - past 16h, less than half of daily goal
        if (hour >= 16 && consumedToday < user.daily_goal / 2) {
        alertsToCreate.push({
            userId: user.id,
            severity: 'YELLOW',
            message: `${user.surname} — is below half of daily goal, only ${Math.round(consumedToday)}ml consumed.`
        });
        }

    }

    // If we want to store the alerts
    //await prisma.alertLog.createMany({ data: alertsToCreate });

    res.json({ message: `${alertsToCreate.length} alert(s) created.`, alerts: alertsToCreate });

    } catch (error) {
        console.error('Analysis error:', error);
        res.status(500).json({ message: `Server error: ${error}` });
    }
});


export default router;