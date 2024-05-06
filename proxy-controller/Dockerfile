FROM node:20-alpine

RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app

WORKDIR /home/node/app

COPY package*.json index.mjs ./

RUN npm install

EXPOSE 3000

CMD [ "node", "index.mjs" ]
