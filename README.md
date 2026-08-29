# Community Connect / KJV Foundation Backend

Robust and scalable Node.js + TypeScript backend API supporting Postgres, MongoDB, Redis, WebSockets, and Cloudflare R2 / Firebase integrations.

## 🚀 Features

- **Authentication & Authorization**: Role-based access control, JWT authentication (Access & Refresh tokens), OTP verification.
- **Multi-Database Support**:
  - **PostgreSQL**: Structured entity storage (users, complaints, staff, subscriptions, etc.)
  - **MongoDB**: Document storage & feeds.
  - **Redis**: Caching, rate limiting, and real-time pub/sub adapter.
- **Real-Time Communication**: Socket.io integration with Redis adapter.
- **File Storage**: Cloudflare R2 / AWS S3 compatible storage.
- **Push Notifications**: Firebase Cloud Messaging (FCM).

---

## 🛠️ Tech Stack

- **Runtime**: Node.js (ES Modules)
- **Language**: TypeScript
- **Framework**: Express.js
- **Databases**: PostgreSQL (`pg`), MongoDB (`mongoose`), Redis (`ioredis`)
- **Realtime**: Socket.io
- **Security**: Helmet, CORS, Rate Limit, Bcrypt, Zod

---

## 📦 Getting Started

### 1. Prerequisites
- Node.js (v18+ recommended)
- PostgreSQL
- MongoDB
- Redis

### 2. Installation
```bash
npm install
```

### 3. Environment Configuration
Copy `.env.example` to `.env` and fill in the required credentials:
```bash
cp .env.example .env
```

### 4. Running the Server
```bash
# Development mode (with hot reloading)
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

---

## 📂 Project Structure

```
├── scripts/             # Database initialization and migration scripts
├── src/
│   ├── infrastructure/  # Database, cache, storage, realtime, and push notification configs
│   ├── modules/         # Feature modules (auth, complaints, posts, chat, users, etc.)
│   ├── shared/          # Shared middlewares, error handlers, and utility functions
│   ├── app.ts           # Express application setup
│   └── server.ts        # Entry point and server initialization
├── tsconfig.json        # TypeScript configuration
└── Dockerfile           # Containerization configuration
```
