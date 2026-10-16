FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN --mount=type=secret,id=cloud_ca,required=false \
    if [ -f /run/secrets/cloud_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/cloud_ca; fi; \
    npm ci --workspace=@hypernova/api --workspace=@hypernova/admin --workspace=@hypernova/contracts --include-workspace-root --ignore-scripts
COPY packages/contracts packages/contracts
COPY apps/api apps/api
COPY apps/admin apps/admin
RUN npm run build -w @hypernova/contracts && npm run build -w @hypernova/api && npm run build -w @hypernova/admin

FROM build AS api
COPY infra/data infra/data
COPY infra/docker/api-entrypoint.sh /app/api-entrypoint.sh
RUN mkdir -p /app/runtime \
    && sed -i 's/\r$//' /app/api-entrypoint.sh \
    && chmod -R a+rX /app/apps /app/packages /app/node_modules /app/infra \
    && chmod a+r /app/package*.json \
    && chmod 755 /app/api-entrypoint.sh
WORKDIR /app/apps/api
EXPOSE 3000
ENTRYPOINT ["/app/api-entrypoint.sh"]

FROM nginx:1.27-alpine AS admin
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html
COPY infra/docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
