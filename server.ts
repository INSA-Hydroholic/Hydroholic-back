import express from 'express';
import { HydrationDAO } from './dao/hydration.dao'; 

const app = express();
app.use(express.json());

app.post('/api/water', async (req, res) => {
  try {
    const { userId, weight } = req.body;

    const newLog = await HydrationDAO.createLog(userId, weight);

    res.status(200).json({ message: "Data saved successfully！", data: newLog });
  } catch (error) {
    res.status(500).json({ error: "server error" });
  }
});


app.get('/api/water/history/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    

    const history = await HydrationDAO.getHistoryByUserId(userId);
    
    res.status(200).json(history);
  } catch (error) {
    res.status(500).json({ error: "server error" });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 server：http://localhost:${PORT}`);
});