FROM oven/bun:1.3-slim
WORKDIR /app
COPY package.json server.ts ./
RUN bun install --production
EXPOSE 3000
CMD ["bun", "run", "server.ts"]
