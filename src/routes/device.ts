import { Router } from 'express';
import { DeviceDAO } from '../dao/device.dao';
import { prisma } from '../lib/prisma';

const router = Router();
const connectionCodes: { [establishmentID: string]: string } = {};

function getConnectionCode(establishmentID: string): string {
    if (!connectionCodes[establishmentID]) {
        // Generate a random 6-digit code
        connectionCodes[establishmentID] = Math.floor(100000 + Math.random() * 900000).toString();
    }
    return connectionCodes[establishmentID];
}

// Route for an ESP to register itself
router.post('/register', async (req, res) => {
    try {
        const { deviceID, connectionCode } = req.body;
        if (!deviceID) return res.status(400).json({ message: 'Device ID required' });
        // TODO : Connection code is optional for now, make compulsory when firmware supports it
        if (!connectionCode) console.warn({ message: 'Connection code required' });

        // Check if connection code exists and matches
        if (connectionCode && !Object.values(connectionCodes).includes(connectionCode)) {
            return res.status(400).json({ message: 'Invalid connection code' });
        } else if (connectionCode) {
            // If connection code is valid, we can delete it to prevent reuse
            const Id = Object.keys(connectionCodes).find(key => connectionCodes[key] === connectionCode);
            if (Id) delete connectionCodes[Id];
        }


        const device = await DeviceDAO.register(deviceID);
        res.status(201).json({ message: 'Device registered', device });
    } catch (error) {
        res.status(500).json({ message: 'Error during registration' });
    }
});

// Main service: ESP posts its measures
// POST/api/device/measure
router.post('/:deviceID/logs', async (req, res) => {
    try {
        const { deviceID } = req.params;
        //changer en CSV
        const { weight, time, stable } = req.body;

        if (weight === undefined || deviceID === undefined) {
            return res.status(400).json({ message: 'Incomplete data: weight or deviceID missing' });
        }
        if (time === undefined) {
            console.warn("Time missing in ESP32 payload. Defaulting to server time.");
        }

        // Recover userId and deviceId based on the Device ID of the ESP
        const device = await DeviceDAO.findUserByMac(deviceID);

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
            source: `ESP32_WiFi_${deviceID}`,
            measured_at: time ? new Date(parseInt(time) * 1000) : undefined
        });

        res.status(201).json({ status: 'success', data: newLog });

    } catch (error) {
        console.error("Error with measure endpoint:", error);
        res.status(500).json({ message: 'Error while creating hydration log' });
    }
});

// Called by ESP
// Post battery status
router.post('/:deviceID/status', async (req, res) => {
    try {
        const { deviceID } = req.params;
        const { battery, time } = req.body;

        const date = time ? new Date(parseInt(time) * 1000) : new Date();
        await DeviceDAO.updateBattery(deviceID, parseInt(battery), date);

        res.json({ message: 'Battery status updated' });
    } catch (error) {
        res.status(500).json({ message: 'Error while updating battery status' });
    }
});

// Called by the Frontend. Get the connection code for a given establishment.
router.get('/connectionCode', async (req, res) => {
    const { establishmentID } = req.body;

    if (!establishmentID) {
        return res.status(400).json({ message: 'Establishment ID required' });
    }

    const connectionCode = getConnectionCode(establishmentID);
    res.json({ connectionCode });
});

// Get the list of devices for a given establishment.
router.get('/devicesListByEstablishment/:establishmentID', async (req, res) => {
    try {
        const { establishmentID } = req.params;
        const devices = DeviceDAO.findDevicesByEstablishment(establishmentID);
        res.json(devices);
    } catch (error) {
        res.status(500).json({ message: 'Error while fetching devices' });
    }
});


export default router;