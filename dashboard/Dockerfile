# Stage 1: Build the real React application
FROM node:22-alpine AS build
WORKDIR /app

# Configure Node memory optimization
ENV NODE_OPTIONS="--max-old-space-size=512"
# Tell React scripts to treat warnings/missing strict case paths as non-fatal during the build
ENV CI=false

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

# Stage 2: Serve using Nginx
FROM nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
