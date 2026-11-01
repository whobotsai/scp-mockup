# Minimal runtime image for this service -- production dependencies only (this service's
# package.json has no "engines" field, so Node 20 LTS is just this image's own choice).
# NOT fully verified: a build attempt from the sandbox that wrote this got past Dockerfile
# parsing but then hit Docker Hub's anonymous-pull rate limit (429) resolving node:20-alpine
# -- an external/shared-IP limit, not a flaw found in this file, but it means the image was
# never actually finished building or run here. docker-compose.yml's own structure (service
# wiring, env_file requirements) *was* validated via `docker compose config`. Build/run this
# yourself once Docker Hub is reachable, directly or via the root docker-compose.yml, which
# wires this up with Postgres and the other two services:
#   docker compose up --build
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3002
CMD ["npm", "start"]
