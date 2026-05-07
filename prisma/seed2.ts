import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const { Pool } = pg;
const connectionString = `postgresql://${process.env["POSTGRES_USER"]}:${process.env["POSTGRES_PASSWORD"]}@${process.env["POSTGRES_HOST"]}:${process.env["POSTGRES_PORT"]}/${process.env["POSTGRES_DB"]}?schema=public`;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter });

/**
 * Simule une session de boisson de manière relative à l'heure actuelle
 */
function simulateSessionRelative(
  userId: number,
  consumed: number,
  minutesAgo: number
): { userID: number; weight: number; source: string; measured_at: Date }[] {
  const logs = [];
  const now = new Date();
  const startWeight = consumed + 50;
  const totalSamples = 6;
  const dropPerSample = consumed / totalSamples;

  for (let i = 0; i <= totalSamples; i++) {
    const noise = (Math.random() - 0.5) * 2;
    const weight = Math.round(startWeight - dropPerSample * i + noise);
    // On recule dans le temps selon minutesAgo
    const measured_at = new Date(now.getTime() - minutesAgo * 60000 + i * 30000);
    logs.push({ userID: userId, weight, source: "esp32", measured_at });
  }
  return logs;
}

async function addHydration(userId: number, consumed: number, minutesAgo: number) {
  const logs = simulateSessionRelative(userId, consumed, minutesAgo);
  for (const log of logs) {
    await prisma.hydrationLog.create({ data: log });
  }
}

async function main() {
  console.log("Nettoyage et réinitialisation...");
  await prisma.alertLog.deleteMany();
  await prisma.hydrationLog.deleteMany();
  await prisma.user.deleteMany();
  await prisma.device.deleteMany();
  await prisma.organization.deleteMany();

  // Reset des séquences pour repartir de ID=1
  const tables = ['User', 'Device', 'Organization', 'HydrationLog', 'AlertLog'];
  for (const t of tables) {
    await prisma.$executeRawUnsafe(`ALTER SEQUENCE "${t}_id_seq" RESTART WITH 1`);
  }

  const org = await prisma.organization.create({
    data: { name: "Hôpital des Tests", adresse: "456 Avenue Data, Lyon", type: "EHPAD" }
  });
  await prisma.user.create({
    data: {
      username: "jean_nurse", email: "jean.dupont@residence-test.fr",
      password_hash: "Hydroholic123!", role: "STAFF",
      name: "Jean", surname: "Dupont", organizationId: org.id,
    }
  });

  const now = new Date();

  // 1. CAS BATTERIE FAIBLE (10%)
  const espLowBatt = await prisma.device.create({ 
    data: { macAddress: "00:00:00:00:00:01", organizationId: org.id, batteryLevel: 10, batteryMeasuredAt: now } 
  });
  await prisma.user.create({
    data: {
      username: "user_low_batt", email: "batt@test.fr", password_hash: "hash", role: "RESIDENT",
      name: "Arthur", surname: "Pile", daily_goal: 1500, esp32Id: espLowBatt.id, organizationId: org.id, room : "101"
    }
  });

  // 2. CAS BATTERIE SILENCIEUSE (48h sans nouvelles)
  const espOldBatt = await prisma.device.create({ 
    data: { 
      macAddress: "00:00:00:00:00:02", 
      organizationId: org.id, 
      batteryLevel: 80, 
      batteryMeasuredAt: new Date(now.getTime() - 48 * 3600000) 
    } 
  });
  await prisma.user.create({
    data: {
      username: "user_old_batt", email: "oldbatt@test.fr", password_hash: "hash", role: "RESIDENT",
      name: "Bernard", surname: "Silence", daily_goal: 1500, esp32Id: espOldBatt.id, organizationId: org.id, room: "102"
    }
  });

  // 3. CAS PAS DE PAYLOAD DEPUIS 7H (Alerte Intervention 6h)
  const espNoData = await prisma.device.create({ 
    data: { 
        macAddress: "00:00:00:00:00:03", 
        organizationId: org.id, 
        weightMeasuredAt: new Date(now.getTime() - 7 * 3600000) // CHAMP CORRIGÉ ICI
    } 
  });
  const userNoData = await prisma.user.create({
    data: {
      username: "user_no_data", email: "nodata@test.fr", password_hash: "hash", role: "RESIDENT",
      name: "Charles", surname: "Inactif", daily_goal: 2000, esp32Id: espNoData.id, organizationId: org.id, room: "103"
    }
  });
  await addHydration(userNoData.id, 300, 420); 

  // 4. CAS PAS BU DEPUIS 3H (Alerte Surveillance)
  const userNoDrink3h = await prisma.user.create({
    data: {
      username: "user_3h", email: "3h@test.fr", password_hash: "hash", role: "RESIDENT",
      name: "Damien", surname: "Soif", daily_goal: 1500, organizationId: org.id, room: "104"
    }
  });
  await addHydration(userNoDrink3h.id, 200, 200); 

  // 5. ALERTE 1/3 OBJECTIF (Goal 1500, bu 400ml < 500ml)
  const userOneThird = await prisma.user.create({
    data: {
      username: "user_1_3", email: "1_3@test.fr", password_hash: "hash", role: "RESIDENT",
      name: "Elise", surname: "Lente", daily_goal: 1500, organizationId: org.id, room: "67"
    }
  });
  await addHydration(userOneThird.id, 400, 30); 

  // 6. ALERTE 1/2 OBJECTIF (Goal 2000, bu 900ml < 1000ml)
  const userHalf = await prisma.user.create({
    data: {
      username: "user_1_2", email: "1_2@test.fr", password_hash: "hash", role: "RESIDENT",
      name: "Franck", surname: "Moitie", daily_goal: 2000, organizationId: org.id, room: "2026"
    }
  });
  await addHydration(userHalf.id, 900, 45);

  console.log("Scénarios de test injectés avec succès !");
}

main()
  .catch((e) => { console.error('Seeding failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });