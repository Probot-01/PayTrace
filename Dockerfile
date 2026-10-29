# syntax=docker/dockerfile:1.7
# Two runtime images from one build:
#   --target web    Next.js standalone server (small, no dev dependencies)
#   --target tools  migrations, background worker and admin scripts (full dependencies)

ARG NODE_VERSION=22.22.0

FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Optional extra CA for builds behind a TLS-inspecting proxy: --secret id=extra_ca,src=/path/ca.pem
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:${NODE_VERSION}-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

FROM node:${NODE_VERSION}-bookworm-slim AS tools
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app app
COPY --from=deps --chown=app:app /app/node_modules ./node_modules
COPY --chown=app:app package.json tsconfig.json ./
COPY --chown=app:app drizzle ./drizzle
COPY --chown=app:app scripts ./scripts
COPY --chown=app:app src ./src
USER app
# Default: the background job worker. Override with `npm run db:migrate`, `npm run create-admin -- --email …`.
CMD ["npm", "run", "worker"]
