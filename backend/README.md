# Backend

The Express API connects to MongoDB Atlas using `MONGODB_URI` from `backend/.env`.

## Start the API

From the repository root, install dependencies and create the backend environment file if you have not already:

```bash
npm install
cp backend/.env.example backend/.env
```

Set `MONGODB_URI` in `backend/.env`, then start the API from the `backend` directory:

```bash
cd backend
npm run dev
```

The server listens on `127.0.0.1:5000` by default. Set `PORT` in `backend/.env` to use another local port. It is bound to the local machine while API authentication is not implemented.

## Read endpoints

- `GET /api/health` returns the API and MongoDB connection status. It returns HTTP `200` when the database is connected and `503` otherwise.
- `GET /api/professors`
- `GET /api/course-sections`
- `GET /api/evaluation-cycles`
- `GET /api/observations`
- `GET /api/observer-matches`
- `GET /api/surveys`

Collection responses use the shape `{ "data": [...] }`. Professor results omit `password_hash`. These local read endpoints are for development with mock data; add authentication and authorization before exposing them beyond the local machine or using real faculty data.

The Vite development server proxies `/api` requests to `http://localhost:5000`, so frontend code can call paths such as `/api/course-sections` without hard-coding the backend origin. Write endpoints are not implemented yet.
