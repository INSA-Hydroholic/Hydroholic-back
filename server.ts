import express from 'express';
import { PrismaClient } from '@prisma/client';

const app = express();
const prisma = new PrismaClient();

app.use(express.json());

app.post('/api/water', async (req, res) => {
  try {
    const { userId, weight } = req.body;

    const newLog = await prisma.hydrationLog.create({
      data: {
        userID: userId,
        weight_value: weight,
        measured_at: new Date() 
      }
    });

    console.log("✅ received and saved:", newLog);

    res.status(200).json({ message: "success！", data: newLog });

  } catch (error) {
    console.error("❌ save failed：", error);
    res.status(500).json({ error: "save failed" });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 backend server is running at :http://localhost:${PORT}`);
});