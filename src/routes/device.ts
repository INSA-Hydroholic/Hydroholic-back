import { Router } from 'express';
import { DeviceDAO } from '../dao/device.dao';

const router = Router();
import { prisma } from '../lib/prisma';

// Route for an ESP to register itself
router.post('/register', async (req, res) => {
    try {
        const { mac } = req.body;
        if (!mac) return res.status(400).json({ message: 'MAC Address required' });

        const device = await DeviceDAO.register(mac);
        res.status(201).json({ message: 'Device registered', device });
    } catch (error) {
        res.status(500).json({ message: 'Error during registration' });
    }
});

// Main service: ESP posts its measures
// POST/api/device/measure
router.post('/:mac/logs', async (req, res) => {
    try {
        const { mac } = req.params;
        const { weight, time, stable } = req.body;

        if (weight === undefined || mac === undefined) {
            return res.status(400).json({ message: 'Incomplete data: weight or mac missing' });
        }
        if (time === undefined) {
            console.warn("Time missing in ESP32 payload. Defaulting to server time.");
        }
        
        // Recover userId and deviceId based on the MAC address of the ESP
        const device = await DeviceDAO.findUserByMac(mac);

        if (!device) {
            return res.status(404).json({ message: 'Couldn\'t find device' });
        }
        if (!device.user) {
            return res.status(404).json({ message: 'Device found but no associated user' });
        }

        // Create a new Hydration Log object
        const newLog = await DeviceDAO.createMeasure({
            weight: parseFloat(weight),
            userID: device.user.id,
            source: `ESP32_WiFi_${mac}`,
            measured_at: time ? new Date(parseInt(time) * 1000) : undefined
        });

        res.status(201).json({ status: 'success', data: newLog });

    } catch (error) {
        console.error("Error with measure endpoint:", error);
        res.status(500).json({ message: 'Error while creating hydration log' });
    }
});

router.post('/:mac/status', async (req, res) => {
    try {
        const { mac } = req.params;
        const { battery, time } = req.body;

        const date = time ? new Date(parseInt(time) * 1000) : new Date();
        await DeviceDAO.updateBattery(mac, parseInt(battery), date);

        res.json({ message: 'Battery status updated' });
    } catch (error) {
        res.status(500).json({ message: 'Error while updating battery status' });
    }
});

export default router;