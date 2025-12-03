# DocsDB - Document Sharing & Monetization Platform

DocsDB is a comprehensive platform for sharing, discovering, and monetizing documents. It leverages modern web technologies to provide a seamless user experience, including AI-powered features, secure file storage, and real-time interactions.

## 🚀 Features

- **Document Management**: Secure upload, storage, and retrieval of documents (PDF, DOCX, etc.).
- **AI Integration**: AI-powered document analysis and features using Google GenAI, HuggingFace, and Groq.
- **Search & Discovery**: Advanced search capabilities with caching for performance.
- **Monetization**: Integration with Stripe for premium content and monetization.
- **Authentication**: Secure user authentication with JWT and OAuth (Google).
- **Responsive Design**: Modern UI built with Next.js and Tailwind CSS, fully responsive across devices.
- **Performance**: Optimized with Redis caching and background job processing using Bull.

## 🛠️ Tech Stack

### Frontend

- **Framework**: [Next.js 14](https://nextjs.org/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/), Framer Motion
- **State Management**: React Hooks
- **HTTP Client**: Axios
- **PWA**: Progressive Web App support

### Backend

- **Runtime**: [Node.js](https://nodejs.org/)
- **Framework**: [Express.js](https://expressjs.com/)
- **Database**: [MongoDB](https://www.mongodb.com/) (with Mongoose)
- **Caching & Queues**: [Redis](https://redis.io/), Bull
- **Storage**: [AWS S3](https://aws.amazon.com/s3/)
- **Validation**: Express Validator
- **Security**: Helmet, CORS, Rate Limiting

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

- [Node.js](https://nodejs.org/) (v18+ recommended)
- [MongoDB](https://www.mongodb.com/)
- [Redis](https://redis.io/)

## 📦 Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/itsoksonu/DocsDB
   cd DocsDB
   ```

2. **Install dependencies**
   This project uses a root `package.json` to manage dependencies for both frontend and backend.
   ```bash
   npm run install:all
   ```

## ⚙️ Configuration

### Backend Configuration

Create a `.env` file in the `server` directory with the following variables:

```env
# Server
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
API_VERSION=v1

# Database
MONGODB_URI=mongodb://localhost:27017/docsdb

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_USERNAME=
REDIS_PASSWORD=

# AWS S3
AWS_REGION=your-region
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
S3_BUCKET_NAME=your-bucket-name

# Security
JWT_SECRET=your-jwt-secret
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=your-jwt-refresh-secret
BCRYPT_SALT_ROUNDS=12

# OAuth2 Configuration
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=

# AI Services
GEMINI_API_KEY=
GROQ_API_KEY=

# External Services
VIRUSTOTAL_API_KEY=

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# File Upload
MAX_FILE_SIZE=104857600 # 100MB
ALLOWED_FILE_TYPES=pdf,docx,pptx,xlsx,csv
```

### Frontend Configuration

Create a `.env.local` file in the `frontend` directory:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-google-client-id
```

## 🏃‍♂️ Running the Application

To run both the frontend and backend concurrently in development mode:

```bash
npm run dev
```

- **Frontend**: http://localhost:3000
- **Backend**: http://localhost:3001

## 📂 Project Structure

```
DocsDB/
├── frontend/          # Next.js Frontend application
│   ├── src/
│   │   ├── components/# Reusable UI components
│   │   ├── pages/     # Application routes
│   │   ├── services/  # API services
│   │   └── styles/    # Global styles
│   └── ...
├── server/            # Express Backend application
│   ├── services/      # Business logic (Auth, Documents, etc.)
│   ├── shared/        # Shared utilities, middleware, database
│   └── ...
├── package.json       # Root configuration
└── README.md          # Project documentation
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License.


