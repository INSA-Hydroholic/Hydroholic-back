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

        // Check if device already exists        
        const existingDevice = await prisma.device.findUnique({ where: { macAddress: deviceID } });
        if (existingDevice) {
            return res.status(200).json({ message: 'Device already registered', device: existingDevice });
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
        const csvData = req.body; // " ( time,weight,stable\n )+"
        
        if (!csvData || typeof csvData !== 'string') {
            return res.status(400).json({ message: 'Incorrect CSV data' });
        }

        if(!deviceID) {
            return res.status(400).json({ message: 'Device ID is required in the URL' });
        }

        // Recover userId and deviceId based on the Device ID of the ESP
        const device = await DeviceDAO.findUserByMac(deviceID);

        if (!device) {
            return res.status(404).json({ message: 'Couldn\'t find device' });
        }
        if (!device.user) {
            return res.status(404).json({ message: 'Device found but no associated user' });
        }

        const lines = csvData.trim().split('\n');
        
        // Basic validation of CSV data
        for (const line of lines) {
        const [epoch, weight, stable] = line.split(',');
        if (weight === undefined) {
            return res.status(400).json({ message: 'Incomplete data: weight missing' });
        }
        if (epoch === undefined) {
            console.warn("Time missing, defaulting to server time.");
        }
        }

        // If all data is ok, create measures in the database using Promise to optimize
        const creationPromises = lines.map(line => {
        const [epoch, weight, stable] = line.split(',');
        return DeviceDAO.createMeasure({
            weight: parseFloat(weight),
            userID: device.user!.id,
            source: `ESP32_WiFi_${deviceID}`,
            measured_at: epoch ? new Date(parseInt(epoch) * 1000) : undefined
        });
        });

        await Promise.all(creationPromises);

        res.status(201).send("Successfully logged all CSV data");

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

// Called by ESP
// Retrieve the UserID associated with a DeviceID
router.get('/:deviceID/user', async (req, res) => {
    try {
        const { deviceID } = req.params;
        const device = await DeviceDAO.findUserByMac(deviceID);
        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }
        if (!device.user) {
            return res.status(404).json({ message: 'Device found but no associated user' });
        }
        res.json(device.user.id);
    } catch (error) {
        res.status(500).json({ message: 'Error while fetching user' });
    }
});

// Called by the Frontend
// Get the connection code for a given establishment.
router.get('/:establishmentID/connectionCode', async (req, res) => {
    const { establishmentID } = req.params;

    if (!establishmentID) {
        return res.status(400).json({ message: 'Establishment ID required' });
    }

    const connectionCode = getConnectionCode(establishmentID);
    res.json({ connectionCode });
});

// Called by Frontend
// Get the list of devices for a given establishment.
router.get('/:establishmentID/listDevices', async (req, res) => {
    try {
        const { establishmentID } = req.params;
        const devices = await DeviceDAO.findDevicesByEstablishment(parseInt(establishmentID));
        res.json(devices);
    } catch (error) {
        res.status(500).json({ message: 'Error while fetching devices' });
    }
});

export default router;