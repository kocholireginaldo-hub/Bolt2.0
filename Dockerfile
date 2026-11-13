# Imagem opcional para hospedar o BOLT (servidor sem dependências).
FROM node:20-alpine
WORKDIR /app
COPY . .
ENV PORT=8787 HOST=0.0.0.0
EXPOSE 8787
USER node
# Com HOST=0.0.0.0 a ponte Wi-Fi OBD2 só liga se BRIDGE_TOKEN for definido.
CMD ["node", "server.js"]
