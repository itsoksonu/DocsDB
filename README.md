# DocsDB - Document Sharing & Monetization Platform

DocsDB is a comprehensive platform for sharing, discovering, and monetizing documents. It leverages modern web technologies to provide a seamless user experience, including AI-powered features, secure file storage, and real-time interactions.

## 🚀 Features

- **Document Management**: Secure upload, storage, and retrieval of documents (PDF, DOCX, etc.) with preview capabilities.
- **Enhanced Collections**: Organize documents into Folder-like collections with custom covers and editing capabilities.
- **Universal Reporting System**: Robust reporting mechanism for bugs and inappropriate content.
- **AI Integration**: AI-powered document analysis and features using Google GenAI and Groq.
- **Smart Feed**: "For You" trending feed with personalization (interactions, "Don't show again").
- **Search & Discovery**: Advanced search capabilities with caching for performance.
- **SEO Optimization**: Fully optimized with Server-Side Rendering (SSR), Sitemap, and Robots.txt transparency.
- **Monetization**: Integration with Stripe for premium content and monetization.
- **Authentication**: Secure user authentication with JWT and OAuth (Google).
- **Security**: Advanced security with API rate limiting, VirusTotal scanning, and secure AWS S3 integrations.
- **Responsive Design**: Modern UI built with Next.js and Tailwind CSS, fully responsive across devices.
- **Performance**: Optimized with Redis caching and background job processing using Bull.

## 🛠️ Tech Stack

### Frontend

- **Framework**: [Next.js 14](https://nextjs.org/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/), Framer Motion
- **State Management**: React Hooks
- **HTTP Client**: Axios
- **PWA**: Progressive Web App support
- **SEO**: `next-sitemap`
- **Utilities**: `dom-to-image-more` (client-side)

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
# Limits are Redis-backed (shared across instances) and keyed per authenticated
# user (falling back to IP for unauthenticated requests). All values are optional
# and have sensible production defaults — only set them to override.
# NOTE: the legacy RATE_LIMIT_WINDOW_MS / RATE_LIMIT_MAX_REQUESTS vars are no
# longer used; remove them.
GLOBAL_RATE_LIMIT_WINDOW_MS=60000   # global IP safety-net window (default 60s)
GLOBAL_RATE_LIMIT_MAX=1000          # global max requests / IP / window
RL_AUTH_MAX=100                     # auth attempts / IP / 15 min
RL_UPLOAD_MAX=300                   # uploads / user / hour
RL_SEARCH_MAX=180                   # searches / user / min
RL_WRITE_MAX=120                    # write ops / user / min
RL_DOWNLOAD_MAX=60                  # downloads / user / min
RL_API_MAX=5000                     # generic API / user / 15 min

# File Upload
MAX_FILE_SIZE=104857600 # 100MB
ALLOWED_FILE_TYPES=pdf,docx,pptx,xlsx,csv

# Automated Document Fetcher
FETCHER_CONTACT_EMAIL=admin@mysite.com   # included in the outbound User-Agent (required by some sources)
FETCHER_SYSTEM_USER_ID=                  # owner user id for fetched docs; falls back to the first admin user
FETCHER_CRON_ENABLED=false               # set true to enable the scheduled fetcher
FETCHER_CRON_SCHEDULE=0 3 * * *          # cron expression — default 3 AM daily
FETCHER_CRON_CATEGORIES=science,health,technology,fiction,education
FETCHER_CRON_COUNT_PER_CATEGORY=20       # documents to fetch per category per run
```

### Frontend Configuration

Create a `.env.local` file in the `frontend` directory:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-google-client-id
NEXT_PUBLIC_GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback
NEXT_PUBLIC_SITE_URL=http://localhost:3000
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

## 📥 Automated Document Fetcher

The Automated Document Fetcher ingests openly-licensed documents from external
sources (Project Gutenberg, arXiv, PubMed Central, Internet Archive, OpenStax)
and feeds them through the **same** processing pipeline as user uploads
(metadata generation, thumbnails, virus scan, embeddings).

**Flow:** admin/cron → Bull `"fetch-documents"` job → `fetchDocuments()` searches
the category's adapters → downloads, de-dupes (by SHA-256 + source id), uploads
to S3 (`uploads/fetched/{source}/...`) → creates a `Document` (`status: "processing"`)
→ enqueues the existing `"process-document"` worker.

### Admin usage

- **UI:** Admin panel → **Fetch Documents**. Pick a category and a count (1–100),
  click **Start Fetch**, and watch live progress.
- **API** (admin-only, behind `authMiddleware + requireRole(["admin"])`):
  - `POST /api/v1/admin/fetch-docs` — body `{ category, count }` → `{ jobId }`
  - `GET  /api/v1/admin/fetch-docs/:jobId` → `{ status, progress, result, failReason }`

### Scheduled fetching

Set `FETCHER_CRON_ENABLED=true` to enable the nightly cron (see env vars above).
On each run it enqueues a fetch job per category in `FETCHER_CRON_CATEGORIES`,
each requesting `FETCHER_CRON_COUNT_PER_CATEGORY` documents. The cron is a no-op
when disabled. Fetched documents are owned by `FETCHER_SYSTEM_USER_ID` (or the
first admin user if unset).

### Source modules

```
server/services/fetcher/
  routes.js          # admin API (POST/GET fetch-docs)
  cron.js            # node-cron scheduled job
server/shared/utils/documentFetcher/
  fetcher.js         # orchestrator (search → download → dedupe → S3 → enqueue)
  categoryMap.js     # category → ordered adapter list
  adapters/          # one file per source
```

### Adding a new adapter

1. Create `server/shared/utils/documentFetcher/adapters/<name>.js` exporting:

   ```js
   export async function search(query, maxResults) {
     // returns Array<{ id, title, author, year, url, format, license }>
     // - `url` must be a direct download link to an allowed file type
     //   (pdf, docx, pptx, xlsx, csv)
     // - include the polite User-Agent on outbound requests:
     //   `DocsDB-Fetcher/1.0 (contact: ${process.env.FETCHER_CONTACT_EMAIL})`
     // - never throw: catch errors, log via logger, and return []
   }
   ```

2. Register it in `fetcher.js`: `import * as <name> from "./adapters/<name>.js";`
   and add it to the `ADAPTERS` map.
3. Route categories to it in `categoryMap.js` by adding the adapter name to the
   relevant category arrays (order = priority). Unmapped categories fall back to
   `["archive"]`.

> **Politeness:** the orchestrator enforces a max of 1 request/second per
> adapter, a 60s download timeout, and one retry before skipping. Only fetch
> from openly-licensed sources — never copyrighted services (Scribd, Z-Library,
> Sci-Hub, etc.).

### Adding an OpenStax book

OpenStax titles are a hardcoded curated list in `adapters/openstax.js`. To add one:

1. Open the book's page at <https://openstax.org/subjects> and copy its direct
   PDF download link (the `assets.openstax.org/...-WEB.pdf` URL).
2. Append an entry to the `BOOKS` array:

   ```js
   {
     id: "openstax-<slug>",          // stable unique id (used for de-dup)
     title: "Book Title",
     author: "OpenStax",
     year: "2024",
     url: "https://assets.openstax.org/.../BookTitle-WEB.pdf",
     subjects: ["science", "education"], // platform categories that route here
   }
   ```

   `format` and `license` (CC BY 4.0) are applied automatically. If a download
   later starts failing, refresh the `url` from the OpenStax site.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License.
