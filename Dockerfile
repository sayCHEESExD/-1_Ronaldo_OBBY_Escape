# The Colyseus server, for Bloxity Hosting.
#
# Built from the REPOSITORY ROOT, not from `server/`. This is an npm workspaces
# monorepo and the server imports `@obby/shared` as a workspace dependency; a
# build context of `server/` alone has no `shared/` to resolve it against and
# no root lockfile to install from.
#
#   docker build -t ronaldo-obby-escape-server .
#   docker run -e PORT=2567 -p 2567:2567 ronaldo-obby-escape-server
#
# Adapted from the working image in sayCHEESExD/-1_speed_moonwalk_escape, which
# is deployed on this platform today. Only the package scope, the data-dir
# variable and the port differ.

# ---------------------------------------------------------------- build ----
FROM node:20-alpine AS build
WORKDIR /app

# The manifests first, so a change to game code does not re-run the install.
# EVERY workspace's package.json is needed, including the client's: npm
# resolves the whole tree in one pass and fails on a workspace whose manifest
# it cannot find, even one this image never runs. See `.dockerignore`, which is
# written specifically to let all three through.
COPY package.json package-lock.json .npmrc ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/

# The full install, dev dependencies included - TypeScript is a devDependency
# and there is nothing to compile without it.
RUN npm ci

COPY shared/ shared/
COPY server/ server/

# Builds `shared` first and then the server, which is the order the server's
# imports require: `@obby/shared` resolves to `shared/dist/index.js`.
RUN npm run build:server

# Drop to production dependencies in place. This keeps the workspace symlinks
# that `@obby/shared` resolves through - deleting node_modules and
# reinstalling per-workspace would break them.
RUN npm prune --omit=dev

# -------------------------------------------------------------- runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
# The host has to be 0.0.0.0 inside a container: binding localhost would leave
# the port unreachable from outside it, which looks exactly like a crashed
# server. `PORT` is left to the host to set - Bloxity, like most managed hosts,
# injects one - and `serverConfig` falls back to DEFAULT_SERVER_PORT (2567).
ENV HOST=0.0.0.0

# Only what running the server needs: the installed production tree and the
# two compiled outputs.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist

# Profiles are a JSON file, and a container filesystem does not survive a
# redeploy. Set explicitly rather than left to the default `data/` beside the
# server, so the path does not depend on the working directory.
#
# ON BLOXITY HOSTING THIS DIRECTORY IS NOT USED FOR LIVE DATA. Pods scale to
# zero and every deploy replaces them, so nothing written here survives an
# update. Bloxity injects MONGODB_URI (a managed database for this game and
# channel) and the server keeps profiles AND pending Bux purchases THERE; the
# boot log reads `using Bloxity managed MongoDB`. Progress does NOT reset on a
# deploy or scale-to-zero, and a signed-in player's profile is keyed by their
# verified Bloxity account, so it is the same on every device. A profiles.json
# found here is imported into the database on boot, insert-only. /data is
# otherwise only the JSON fallback for hosts without a database.
ENV OBBY_DATA_DIR=/data
VOLUME ["/data"]

# Not root. Nothing the server does needs it, and the base image ships a
# `node` user for exactly this.
RUN mkdir -p /data && chown -R node:node /data
USER node

EXPOSE 2567

# The same probe the platform uses, so a container that is up but not listening
# is reported unhealthy rather than as running. It reads PORT rather than
# assuming 2567, because the host injects it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||2567)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Straight to node, with no npm wrapper: npm swallows signals, so a container
# stopped by the host would not run the SIGTERM handler that flushes player
# profiles before the process goes away.
CMD ["node", "server/dist/index.js"]
