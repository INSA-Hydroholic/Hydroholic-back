import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import authRouter from './routes/auth';
import challengesRouter from './routes/challenges';
import usersRouter from './routes/users';
import alertRouter from './routes/alerts';
import deviceRouter from './routes/device';
import organizationRouter from './routes/organization';

dotenv.config();

const app = express();

// 1. middlewares globaux
app.use(cors()); // autoriser les requêtes cross-origin (du front qui tourne sur un autre port)
app.use(express.json()); // let server understand JSON payloads
app.use(express.text({ type: 'text/csv' })); // let server understand raw text payloads (for CSV data)

// Log every request (for debugging)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// 2. load des routes
app.use('/api/auth', authRouter);
app.use('/api/challenges', challengesRouter);
app.use('/api/users', usersRouter);
app.use('/api/alerts', alertRouter);
app.use('/api/device', deviceRouter);
app.use('/api/organization', organizationRouter);

// check server status
app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok', message: '🚀 Hydroholic PostgreSQL backend en marche !' });
});

// 3. start the server
const PORT = Number(process.env.SERVER_PORT || 4000);

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`
  ======================================================
  🚀 Hydroholic Backend Démarré !
  📡 Adresse : http://localhost:${PORT}
  🗄️  Base de données : PostgreSQL (via Prisma)
  ======================================================
  `);
});