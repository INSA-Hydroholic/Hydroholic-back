import { Router } from 'express';
import { MeasureDAO } from '../dao/measure.dao';

const router = Router();
import { prisma } from '../lib/prisma';

// First service : Get ID based on the MAC address of the ESP
// GET /api/device/getId/:mac
router.get('/getId/:mac', async (req, res) => {
    try {
        const { mac } = req.params;

        // On cherche le device, et on "inclut" l'utilisateur lié
        const device = await prisma.device.findUnique({
            where: { macAddress: mac },
            include: { user: true }
        });

        if (!device || !device.user) {
            return res.status(404).json({ message: 'Dispositif ou utilisateur non trouvé' });
        }

        res.json({ userId: device.user.id });
    } catch (error) {
        res.status(500).json({ message: 'Erreur serveur lors de la récupération de l\'ID' });
    }
});

// Main service: ESP posts its measures
// POST/api/device/measure
router.post('/measure', async (req, res) => {
    try {
        const { weight, battery, time, mac } = req.body;

        if (weight === undefined || mac === undefined) {
            return res.status(400).json({ message: 'Incomplete data: weight or mac missing' });
        }
        if (time === undefined) {
            console.warn("Time missing in ESP32 payload. Defaulting to server time.");
        }
        if (battery === undefined) {
            console.warn("Battery level missing in ESP32 payload. Consider checking battery manually.");
        }
        
        // Recover userId and deviceId based on the MAC address of the ESP
        const device = await MeasureDAO.findUserByMac(mac);

        if (!device) {
            return res.status(404).json({ message: 'Couldn\'t find device' });
        }
        if (!device.user) {
            return res.status(404).json({ message: 'Device found but no associated user' });
        }

        // Create a new Hydration Log object
        const newLog = await MeasureDAO.createMeasure({
            weight: parseFloat(weight),
            userId: device.user.id,
            source: `ESP32_WiFi_${mac}`,
            date: time ? new Date(time) : undefined
        });

        res.status(201).json({ status: 'success', data: newLog });

    } catch (error) {
        console.error("Error with measure endpoint:", error);
        res.status(500).json({ message: 'Error while creating hydration log' });
    }
});

export default router;