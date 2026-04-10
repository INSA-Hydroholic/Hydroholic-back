import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({
    connectionString: `postgresql://${process.env["POSTGRES_USERNAME"]}:${process.env["POSTGRES_PASSWORD"]}@${process.env["POSTGRES_HOST"]}:${process.env["POSTGRES_PORT"]}/${process.env["POSTGRES_DB"]}?schema=public`,
});

export const prisma = new PrismaClient({ adapter });

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

async function main() {
  const now = new Date();
  const passwordHash = await bcrypt.hash('Hydroholic123!', 10);

  // Clean in FK-safe order.
  await prisma.challengeParticipant.deleteMany();
  await prisma.relationship.deleteMany();
  await prisma.hydrationLog.deleteMany();
  await prisma.goal.deleteMany();
  await prisma.challenge.deleteMany();
  await prisma.goalType.deleteMany();
  await prisma.user.deleteMany();

  const goalTypes = await prisma.goalType.createManyAndReturn({
    data: [
      { unite: 'ml', duree: 'daily' },
      { unite: 'ml', duree: 'weekly' },
    ],
  });

  const dailyGoalType = goalTypes.find((g) => g.duree === 'daily');
  const weeklyGoalType = goalTypes.find((g) => g.duree === 'weekly');

  if (!dailyGoalType || !weeklyGoalType) {
    throw new Error('GoalType seeding failed.');
  }

  const users = await prisma.user.createManyAndReturn({
    data: [
      {
        email: 'alice@hydroholic.local',
        password_hash: passwordHash,
        nom: 'Martin',
        prenom: 'Alice',
        username: 'alice',
        phone: '+33600000001',
        age: 24,
        sex: 'female',
        weight: 57.3,
        height: 166,
        region: 'Lyon',
        avatar_url: 'https://api.dicebear.com/9.x/adventurer/svg?seed=alice',
        num_intense_activities: 2,
        num_moderate_activities: 4,
        biography: 'I like hydration challenges with friends.',
        daily_goal: 2200,
      },
      {
        email: 'bob@hydroholic.local',
        password_hash: passwordHash,
        nom: 'Durand',
        prenom: 'Bob',
        username: 'bob',
        phone: '+33600000002',
        age: 29,
        sex: 'male',
        weight: 81.5,
        height: 182,
        region: 'Toulouse',
        avatar_url: 'https://api.dicebear.com/9.x/adventurer/svg?seed=bob',
        num_intense_activities: 4,
        num_moderate_activities: 2,
        biography: 'Runner and hiking fan.',
        daily_goal: 2800,
      },
      {
        email: 'clara@hydroholic.local',
        password_hash: passwordHash,
        nom: 'Petit',
        prenom: 'Clara',
        username: 'clara',
        phone: '+33600000003',
        age: 21,
        sex: 'female',
        weight: 62.1,
        height: 170,
        region: 'Nantes',
        avatar_url: 'https://api.dicebear.com/9.x/adventurer/svg?seed=clara',
        num_intense_activities: 1,
        num_moderate_activities: 5,
        biography: 'Trying to improve daily consistency.',
        daily_goal: 2100,
      },
      {
        email: 'david@hydroholic.local',
        password_hash: passwordHash,
        nom: 'Bernard',
        prenom: 'David',
        username: 'david',
        phone: '+33600000004',
        age: 33,
        sex: 'male',
        weight: 76.9,
        height: 178,
        region: 'Paris',
        avatar_url: 'https://api.dicebear.com/9.x/adventurer/svg?seed=david',
        num_intense_activities: 3,
        num_moderate_activities: 3,
        biography: 'Tech worker, needs hydration reminders.',
        daily_goal: 2500,
      },
    ],
  });

  const alice = users.find((u) => u.username === 'alice');
  const bob = users.find((u) => u.username === 'bob');
  const clara = users.find((u) => u.username === 'clara');
  const david = users.find((u) => u.username === 'david');

  if (!alice || !bob || !clara || !david) {
    throw new Error('User seeding failed.');
  }

  await prisma.relationship.createMany({
    data: [
      { requesterID: alice.id, receiverID: bob.id, status: 'ACCEPTED' },
      { requesterID: alice.id, receiverID: clara.id, status: 'PENDING' },
      { requesterID: david.id, receiverID: alice.id, status: 'REJECTED' },
      { requesterID: bob.id, receiverID: clara.id, status: 'ACCEPTED' },
    ],
  });

  await prisma.hydrationLog.createMany({
    data: [
      { userID: alice.id, measured_at: addDays(now, -2), weight: 140.2, source: 'app' },
      { userID: alice.id, measured_at: addDays(now, -1), weight: 139.4, source: 'hydrobase' },
      { userID: bob.id, measured_at: addDays(now, -2), weight: 180.5, source: 'app' },
      { userID: bob.id, measured_at: addDays(now, -1), weight: 179.8, source: 'hydrobase' },
      { userID: clara.id, measured_at: addDays(now, -1), weight: 155.9, source: 'app' },
      { userID: david.id, measured_at: addDays(now, -1), weight: 170.4, source: 'hydrobase' },
    ],
  });

  const globalChallenge = await prisma.challenge.create({
    data: {
      creator_id: alice.id,
      title: '7-Day Hydration Sprint',
      description: 'Reach your hydration target every day for one week.',
      start_date: addDays(now, -1),
      end_date: addDays(now, 6),
      status: 'active',
      challenge_type: 'global',
      objective_ml: 14000,
    },
  });

  const friendsChallenge = await prisma.challenge.create({
    data: {
      creator_id: bob.id,
      title: 'Friends Weekend Boost',
      description: 'Friendly hydration race over the weekend.',
      start_date: addDays(now, -5),
      end_date: addDays(now, -1),
      status: 'completed',
      challenge_type: 'friends',
      objective_ml: 5000,
    },
  });

  await prisma.challengeParticipant.createMany({
    data: [
      { challengeID: globalChallenge.id, userID: alice.id, joined_date: addDays(now, -1), progress_ml: 2100, status: 'active' },
      { challengeID: globalChallenge.id, userID: bob.id, joined_date: addDays(now, -1), progress_ml: 2400, status: 'active' },
      { challengeID: globalChallenge.id, userID: clara.id, joined_date: addDays(now, -1), progress_ml: 1500, status: 'active' },
      { challengeID: friendsChallenge.id, userID: bob.id, joined_date: addDays(now, -5), progress_ml: 5200, status: 'completed' },
      { challengeID: friendsChallenge.id, userID: david.id, joined_date: addDays(now, -5), progress_ml: 3200, status: 'quit' },
    ],
  });

  await prisma.goal.createMany({
    data: [
      {
        userID: alice.id,
        goal_type_id: dailyGoalType.id,
        value: 2200,
        start_date: addDays(now, -30),
        end_date: addDays(now, 30),
        status: 'active',
      },
      {
        userID: bob.id,
        goal_type_id: weeklyGoalType.id,
        value: 18000,
        start_date: addDays(now, -7),
        end_date: addDays(now, 21),
        status: 'active',
      },
      {
        userID: clara.id,
        goal_type_id: dailyGoalType.id,
        value: 2000,
        start_date: addDays(now, -40),
        end_date: addDays(now, -10),
        status: 'completed',
      },
      {
        userID: david.id,
        goal_type_id: weeklyGoalType.id,
        value: 16000,
        start_date: addDays(now, -20),
        end_date: addDays(now, -5),
        status: 'cancelled',
      },
    ],
  });

  console.log('Database seeded successfully.');
  console.log('Test users: alice, bob, clara, david');
  console.log('Test password for all users: Hydroholic123!');
}

main()
  .catch((error) => {
    console.error('Seeding failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });