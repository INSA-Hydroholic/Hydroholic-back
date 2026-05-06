import { Router } from 'express';
import { ChallengeDAO } from '../dao/challenge.dao';
import { ChallengeParticipantDAO } from '../dao/participant.dao';
import { prisma } from '../lib/prisma';

import { HydrationDAO } from '../dao/hydration.dao';

const router = Router();

const DRINK_THRESHOLD_3H = 50; // ml minimum expected in last 3h
const DRINK_THRESHOLD_6H = 50; // ml minimum expected in last 6h

// Calculate if alerts exist for a given user and sends them directly (no storing in DataBase)
// The user MUST have an ESP32 associated
// 4 types of alerts :
// - Not drinking for more than 3 hours (Yellow)
// - Not drinking for more than 6 hours (Red)
// - Not drinking a third of objective at 12h (Yellow)
// - Not drinking half of objective at 16h (Yellow)
router.get('/:establishmentId/alerts', async (req, res) => {
try {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    const hour = new Date().getHours();

    const demoTime = new Date(now.getTime() - 60*1000); // For demo purposes, we set "now" to 1 minute ago, to trigger the 3h alert quickly

    const users = await prisma.user.findMany({
        where: {
            esp32Id: { not: null },
            organizationId: parseInt(req.params.establishmentId)
        },
        select: {
            id: true,
            surname: true,
            daily_goal: true,
            esp32: {
                select: {
                    id: true,
                    batteryMeasuredAt: true,
                    updated_at: true,
                }
            }
        }
    });

    const alertsToCreate = [];

    // For each user, fetch consumption in said daytimes
    for (const user of users) {
        const [consumed3h, consumed6h, consumedToday] = await Promise.all([
            HydrationDAO.getTotalConsumedByRange(user.id, threeHoursAgo, now),
            HydrationDAO.getTotalConsumedByRange(user.id, sixHoursAgo, now),
            HydrationDAO.getTotalConsumedByRange(user.id, startOfDay, now)
        ]);

        const demoConsumption = await HydrationDAO.getTotalConsumedByRange(user.id, demoTime, now);

        if(consumedToday >= parseInt(user.daily_goal)){
            continue;
        }

        if (demoConsumption < DRINK_THRESHOLD_3H) {
            if (user.surname === 'Minettinho') {
                alertsToCreate.push({
                    userId: user.id,
                    severity: 'YELLOW',
                    message: `Jhouny n'a pas bu dans la dernière minute — il n'est pas un vrai Hydroholic.`
                });
            }
            else {
                // alertsToCreate.push({
                //     userId: user.id,
                //     severity: 'YELLOW',
                //     message: `${user.surname} hasn't drunk in the last 1 minute — monitoring recommended.`
                // });
            }
        }

      // Rule 1 - Below threshold in last 6h
        if (consumed6h < DRINK_THRESHOLD_6H) {
        alertsToCreate.push({
            userId: user.id,
            severity: 'RED',
            message: `${user.surname} n'a pas bu dans les dernières 6 heures — intervention recommandée.`
        });
        // Rule 2 - Nothing drunk in last 3h
        } else if (consumed3h < DRINK_THRESHOLD_3H) {
        alertsToCreate.push({
            userId: user.id,
            severity: 'YELLOW',
            message: `${user.surname} n'a pas bu dans les dernières 3 heures — surveillance recommandée.`
        });
        }

        // Rule 3 - past noon, less than 1/3 of daily goal
        if (hour >= 12 && consumedToday < user.daily_goal / 3) {
        alertsToCreate.push({
            userId: user.id,
            severity: 'YELLOW',
            message: `${user.surname} — est en dessous de 1/3 de son objectif quotidien, seulement ${Math.round(consumedToday)}ml consommés.`
        });
        }

        // Rule 4 - past 16h, less than half of daily goal
        if (hour >= 16 && consumedToday < user.daily_goal / 2) {
        alertsToCreate.push({
            userId: user.id,
            severity: 'YELLOW',
            message: `${user.surname} — est en dessous de la moitié de son objectif quotidien, seulement ${Math.round(consumedToday)}ml consommés.`
        });
        }


        // Rule 5: If a user's ESP hasn't sent battery or weight information for a while, consider them as disconnected
        if (user.esp32) {
            const secondsSinceBattery = user.esp32.batteryMeasuredAt
                ? (now.getTime() - new Date(user.esp32.batteryMeasuredAt).getTime()) / 1000
                : Infinity;

            const secondsSinceUpdate = (now.getTime() - new Date(user.esp32.weightMeasuredAt).getTime()) / 1000;

            if (secondsSinceUpdate > 60) {
                alertsToCreate.push({
                    userId: user.id,
                    severity: 'GREY',
                    message: `Device ${user.esp32.id} est déconnecté. Dernière mise à jour à ${user.esp32.weightMeasuredAt}.`
                });
            } else if (secondsSinceBattery > 30) {
                let time = user.esp32.batteryMeasuredAt;
                if (!time)
                {
                    time = "sa première connexion";
                }
                alertsToCreate.push({
                    userId: user.id,
                    severity: 'GREY',
                    message: `Device ${user.esp32.id} n'a pas envoyé de données de batterie depuis ${time}. Il pourrait ne plus avoir de batterie.`
                });
            }
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