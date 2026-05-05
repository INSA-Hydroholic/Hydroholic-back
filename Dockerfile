FROM node:22-alpine

WORKDIR /app

# Install npm dependencies first to leverage Docker caching
COPY package.json ./
COPY package-lock.json ./

RUN npm ci

# Then, generate Prisma client
COPY ./prisma/schema.prisma ./prisma/

RUN npx prisma generate

COPY . .

EXPOSE 3000

# 'CMD' is used to set the default command to run for this container.
CMD ["npm", "start"]