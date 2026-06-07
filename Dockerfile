# Dev image for the NestJS app and worker. Node 26 matches .nvmrc; corepack was
# removed from Node 25+, so pnpm is installed via npm at the pinned version.
FROM node:26-bookworm-slim

RUN npm install -g pnpm@11.5.1
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 3000
CMD ["pnpm", "dev"]
