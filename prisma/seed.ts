import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const { Pool } = pg;
const connectionString = `postgresql://${process.env["POSTGRES_USER"]}:${process.env["POSTGRES_PASSWORD"]}@${process.env["POSTGRES_HOST"]}:${process.env["POSTGRES_PORT"]}/${process.env["POSTGRES_DB"]}?schema=public`;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter });

// Simulates 7 load-cell readings over 3 minutes — bottle drains from (consumed+50) down to ~50g
function simulateSession(
  userId: number,
  consumed: number,
  startHour: number
): { userID: number; weight: number; source: string; measured_at: Date }[] {
  const logs = [];
  const today = new Date();
  const startWeight = consumed + 50;
  const totalSamples = 6; // 7 points: i=0..6
  const dropPerSample = consumed / totalSamples;

  for (let i = 0; i <= totalSamples; i++) {
    const noise = (Math.random() - 0.5) * 2; // ±1g
    const weight = Math.round(startWeight - dropPerSample * i + noise);
    const measured_at = new Date(today);
    measured_at.setHours(startHour, 0, 0, 0);
    measured_at.setSeconds(i * 30); // one sample every 30 seconds
    logs.push({ userID: userId, weight, source: "esp32", measured_at });
  }
  return logs;
}

async function insertSessions(
  userId: number,
  sessions: { consumed: number; hour: number }[]
) {
  for (const s of sessions) {
    const logs = simulateSession(userId, s.consumed, s.hour);
    for (const log of logs) {
      await prisma.hydrationLog.create({ data: log });
    }
  }
}

async function main() {
  console.log("Nettoyage de la base");
  await prisma.alertLog.deleteMany();
  await prisma.hydrationLog.deleteMany();
  await prisma.user.deleteMany();
  await prisma.device.deleteMany();
  await prisma.organization.deleteMany();

  await prisma.$executeRawUnsafe(`ALTER SEQUENCE "User_id_seq" RESTART WITH 1`);
  await prisma.$executeRawUnsafe(`ALTER SEQUENCE "Device_id_seq" RESTART WITH 1`);
  await prisma.$executeRawUnsafe(`ALTER SEQUENCE "Organization_id_seq" RESTART WITH 1`);
  await prisma.$executeRawUnsafe(`ALTER SEQUENCE "HydrationLog_id_seq" RESTART WITH 1`);
  await prisma.$executeRawUnsafe(`ALTER SEQUENCE "AlertLog_id_seq" RESTART WITH 1`);

  const org = await prisma.organization.create({
    data: { name: "Résidence Test", adresse: "123 Rue de la République, 69000 Lyon", type: "EHPAD" }
  });

  await prisma.user.create({
    data: {
      username: "jean_nurse", email: "jean.dupont@residence-test.fr",
      password_hash: "Hydroholic123!", role: "STAFF",
      name: "Jean", surname: "Dupont", organizationId: org.id,
    }
  });

  const esp1 = await prisma.device.create({ data: { macAddress: "AA:BB:CC:DD:EE:01", organizationId: org.id } });
  const esp2 = await prisma.device.create({ data: { macAddress: "AA:BB:CC:DD:EE:02", organizationId: org.id } });
  const esp3 = await prisma.device.create({ data: { macAddress: "AA:BB:CC:DD:EE:03", organizationId: org.id } });

  // ── Yvette : objectif ATTEINT (goal 1500, 1600 consumed) ──
  const yvette = await prisma.user.create({
    data: {
      username: "jhouny_minettinho", email: "jhony.gato@lindao.fr",
      room : "101",
      password_hash: "resident-placeholder", role: "RESIDENT",
      name: "Jhouny", surname: "Minettinho",
      age: 82, weight: 58.0, sex: "F", daily_goal: 1500,
      esp32Id: esp1.id, organizationId: org.id,
    }
  });
  await insertSessions(yvette.id, [
    { consumed: 300, hour: 8  },
    { consumed: 280, hour: 10 },
    { consumed: 380, hour: 12 },
    { consumed: 340, hour: 15 },
    { consumed: 300, hour: 17 },
  ]);

  // ── Marguerite : PEU bu + ALERTE ROUGE (goal 2000, 400 consumed) ──
  const marguerite = await prisma.user.create({
    data: {
      username: "m_fontaine", email: "marguerite.fontaine@residence-test.fr",
      password_hash: "resident-placeholder", role: "RESIDENT",
      room : "102",
      name: "Imane", surname: "Taaaaaaarabit",
      age: 78, weight: 63.5, sex: "F", daily_goal: 2000,
      esp32Id: esp2.id, organizationId: org.id,
    }
  });
  await insertSessions(marguerite.id, [
    { consumed: 400, hour: 8 },
  ]);
  await prisma.alertLog.create({
    data: {
      userId: marguerite.id,
      message: "N'a pas bu depuis 6h — seulement 400 mL aujourd'hui",
      severity: "RED", isResolved: false,
    }
  });

  // ── Roger : mi-chemin + ALERTE JAUNE (goal 1800, 850 consumed) ──
  const roger = await prisma.user.create({
    data: {
      username: "roger_blanche", email: "roger.blanche@residence-test.fr",
      password_hash: "resident-placeholder", role: "RESIDENT",
      room : "103",
      name: "Vini", surname: "Vidi-Vici",
      age: 85, weight: 72.0, sex: "M", daily_goal: 1800,
      esp32Id: esp3.id, organizationId: org.id,
    }
  });
  await insertSessions(roger.id, [
    { consumed: 200, hour: 8  },
    { consumed: 350, hour: 11 },
    { consumed: 300, hour: 14 },
  ]);
  await prisma.alertLog.create({
    data: {
      userId: roger.id,
      message: "Objectif journalier à mi-chemin — à surveiller",
      severity: "YELLOW", isResolved: false,
    }
  });

  console.log("Base de données prête");
}

main()
  .catch((e) => { console.error('Seeding failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });