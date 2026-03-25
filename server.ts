import express from 'express';
import { UserDAO } from './dao/user.dao';
import { HydrationDAO } from './dao/hydration.dao';
import { ChallengeDAO } from './dao/challenge.dao';
import { ChallengeParticipantDAO } from './dao/participant.dao';

const app = express();
app.use(express.json());

app.post('/api/users', async (req, res) => {
    try {
        const newUser = await UserDAO.createUser(req.body);
        res.status(201).json({ message: "User created successfully", data: newUser });
    } catch (error) {
        res.status(500).json({ error: "Failed to create user", details: String(error) });
    }
});

app.get('/api/users/:id', async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const user = await UserDAO.getUserById(userId);
        if (!user) return res.status(404).json({ error: "User not found" });
        res.status(200).json(user);
    } catch (error) {
        res.status(500).json({ error: "Query failed" });
    }
});

app.put('/api/users/:id', async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const updatedUser = await UserDAO.updateUser(userId, req.body);
        res.status(200).json({ message: "Update successful", data: updatedUser });
    } catch (error) {
        res.status(500).json({ error: "Update failed" });
    }
});

app.post('/api/water', async (req, res) => {
    try {
        const newLog = await HydrationDAO.createHydrationLog(req.body);
        res.status(201).json({ message: "Hydration data recorded", data: newLog });
    } catch (error) {
        res.status(500).json({ error: "Failed to record hydration data" });
    }
});

app.get('/api/water/history/:userId', async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const history = await HydrationDAO.getHistoryByUserId(userId);
        res.status(200).json(history);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch history records" });
    }
});

app.get('/api/water/history/range/:userId', async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const startDate = new Date(req.query.start as string);
        const endDate = new Date(req.query.end as string);
        const history = await HydrationDAO.getHistoryByDateRange(userId, startDate, endDate);
        res.status(200).json(history);
    } catch (error) {
        res.status(500).json({ error: "Date range query failed" });
    }
});

app.post('/api/challenges', async (req, res) => {
    try {
        const newChallenge = await ChallengeDAO.createChallenge(req.body);
        res.status(201).json({ message: "Challenge created successfully", data: newChallenge });
    } catch (error) {
        res.status(500).json({ error: "Failed to create challenge" });
    }
});

app.get('/api/challenges/user/:userId', async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const challenges = await ChallengeDAO.getChallengesByUser(userId);
        res.status(200).json(challenges);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch challenges" });
    }
});

app.delete('/api/challenges/:id', async (req, res) => {
    try {
        const challengeId = parseInt(req.params.id);
        await ChallengeDAO.deleteChallenge(challengeId);
        res.status(200).json({ message: "Challenge deleted successfully" });
    } catch (error) {
        res.status(500).json({ error: "Failed to delete challenge" });
    }
});

app.post('/api/participants', async (req, res) => {
    try {
        const participation = await ChallengeParticipantDAO.createParticipant(req.body);
        res.status(201).json({ message: "Successfully joined the challenge", data: participation });
    } catch (error) {
        res.status(500).json({ error: "Failed to join the challenge" });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`
    =============================================
    🚀 Hydroholic backend server started!
    📡 Listening on port: http://localhost:${PORT}
    =============================================
    `);
});