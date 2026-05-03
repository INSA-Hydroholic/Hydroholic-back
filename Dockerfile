FROM node:25-alpine

WORKDIR /app

# Install npm dependencies first to leverage Docker caching
COPY package.json ./

RUN npm install

# Then, generate Prisma client
COPY ./prisma/schema.prisma ./prisma/

RUN npx prisma generate

COPY . .

EXPOSE 3000
# EXPOSE 5555 (npx prisma studio)
# EXPOSE 8080 (server port)

# 'CMD' is used to set the default command to run for this container.
CMD ["npm", "start"]