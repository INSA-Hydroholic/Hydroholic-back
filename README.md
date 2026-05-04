# Hydroholic-back

## Setting up project
Install dependencies from `package.json` by running the following from the home project directory (npm):
```bash
npm install
```

## Prisma
You can use Prisma to manage the database directly from the command line. i.e., to apply the latest schema changes to the database, run:
```bash
npx prisma db push
```

## machine learning
need to start python micro server before prediction and cold-start
```bash
cd ml-service
python main.py
```

## Running the project
To run the project in development mode, use the following command:
```bash
npm run dev
```
