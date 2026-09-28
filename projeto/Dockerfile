FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY criot/requirements.txt /app/criot/requirements.txt
RUN python3 -m venv /opt/criot-venv \
    && /opt/criot-venv/bin/pip install --no-cache-dir -r /app/criot/requirements.txt
COPY server.js start.js criot-bridge.js ./
COPY public ./public
COPY criot/app ./criot/app
RUN mkdir -p /app/.data && chown -R node:node /app
USER node
ENV NODE_ENV=production PORT=3000 CRIOT_ENABLED=true AI_PROVIDER=mock PYTHON_BIN=/opt/criot-venv/bin/python
EXPOSE 3000
CMD ["node", "start.js"]
