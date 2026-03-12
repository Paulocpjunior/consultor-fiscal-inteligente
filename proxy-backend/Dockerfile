FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src/ ./src/

EXPOSE 8080

USER node

CMD ["node", "src/server.js"]
```

---

**Arquivo 4:**
```
proxy-backend/.env.example
