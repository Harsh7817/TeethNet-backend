# TeethNet Backend

Backend API for **TeethNet**, an AI-based dental reconstruction platform that converts 2D occlusal jaw images into downloadable 3D STL dental models.

The Node.js backend handles user authentication, image uploads, job tracking, MongoDB storage, and communication with the Python-based AI reconstruction service.

## Features

- User signup and login with JWT authentication
- Secure password hashing using bcrypt
- Authenticated 2D dental image uploads
- Multipart forwarding of uploaded images to the Python AI service
- Asynchronous job submission and status polling
- Download endpoint for generated STL models
- MongoDB integration for users and reconstruction jobs
- MongoDB GridFS storage for uploaded images and generated STL files
- CORS support for frontend deployments
- Docker support for containerized deployment

## Architecture

```text
React Frontend
      |
      | JWT Authentication / Image Upload
      v
Node.js + Express Backend (Port 3000)
      |
      +---------------------> MongoDB
      |                        |
      |                        +--> Users
      |                        +--> Job Metadata
      |                        +--> GridFS Image/STL Storage
      |
      | HTTP / Multipart Requests
      v
Python AI API (Port 8000)
      |
      v
2D Image → Depth/Reconstruction Pipeline → 3D STL Model
```

## Tech Stack

- **Node.js**
- **Express.js**
- **MongoDB + Mongoose**
- **MongoDB GridFS**
- **JWT (jsonwebtoken)**
- **bcryptjs**
- **Multer**
- **Axios**
- **Docker**
- **CORS**

## Prerequisites

Before running the backend, ensure you have:

- Node.js 18 or later
- npm
- MongoDB Atlas or a local MongoDB instance
- The Python TeethNet AI API running and accessible
- Docker (optional)

The backend communicates with the Python API using:

```text
PYTHON_URL/upload/
PYTHON_URL/status/:jobId
PYTHON_URL/download/:jobId
```

## Installation

Clone the repository:

```bash
git clone <your-backend-repository-url>
cd TeethNet-backend
```

Install dependencies:

```bash
npm install
```

## Environment Variables

Create a `.env` file in the project root:

```env
PORT=3000
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_secure_jwt_secret
PYTHON_URL=http://localhost:8000
```

### Variables

| Variable | Description |
|---|---|
| `PORT` | Port used by the Node.js API. Defaults to `3000`. |
| `MONGODB_URI` | MongoDB connection string used for users, jobs, and GridFS storage. |
| `JWT_SECRET` | Secret used to sign and verify JWT tokens. |
| `PYTHON_URL` | Base URL of the Python AI reconstruction API. |

> Do not commit your `.env` file. It is already excluded through `.gitignore`.

## Running Locally

Start the backend:

```bash
npm start
```

The API will run on:

```text
http://localhost:3000
```

## Docker

Build the Docker image:

```bash
docker build -t teethnet-backend .
```

Run the container:

```bash
docker run -p 3000:3000 --env-file .env teethnet-backend
```

When running with other containers, configure `PYTHON_URL` so the backend can reach the Python AI API. For example:

```env
PYTHON_URL=http://python-api:8000
```

## API Endpoints

### Authentication

#### `POST /auth/signup`

Creates a new user and returns a JWT token.

Example request body:

```json
{
  "email": "user@example.com",
  "password": "password123",
  "name": "User"
}
```

Successful response:

```json
{
  "token": "jwt_token",
  "user": {
    "id": "user_id",
    "email": "user@example.com",
    "name": "User"
  }
}
```

#### `POST /auth/login`

Authenticates an existing user and returns a JWT token.

Example request body:

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

### Submit Reconstruction Job

#### `POST /submit`

Uploads a 2D dental image and submits it to the Python AI reconstruction service.

This endpoint requires JWT authentication.

Header:

```text
Authorization: Bearer <token>
```

Request:

```text
multipart/form-data
image: <uploaded-image>
```

The backend:

1. Receives the uploaded image using Multer.
2. Stores the original image in MongoDB GridFS when storage is configured.
3. Forwards the image to the Python AI API.
4. Receives a reconstruction `job_id`.
5. Creates a job record associated with the authenticated user.

Example response:

```json
{
  "job_id": "generated_job_id",
  "db_job_id": "mongodb_job_id",
  "result": null
}
```

### Check Job Status

#### `GET /status/:jobId`

Queries the Python AI service for the current reconstruction status.

Possible states include:

```text
QUEUED
RUNNING
SUCCESS
FAILURE
```

When a job completes successfully, the backend attempts to download the generated STL model from the Python API and persist it in MongoDB GridFS.

### Download Generated STL

#### `GET /download/:jobId`

Downloads the generated STL model for a completed reconstruction job.

The request is forwarded to:

```text
PYTHON_URL/download/:jobId
```

The response is returned as a downloadable:

```text
<jobId>.stl
```

### Stream Stored Files

#### `GET /files/:id`

Streams a file stored in MongoDB GridFS using its file ID.

## Authentication Flow

```text
User Signup/Login
        |
        v
JWT Generated
        |
        v
Frontend Stores Token
        |
        v
Authorization: Bearer <token>
        |
        v
Protected /submit Endpoint
```

Passwords are hashed using `bcrypt` before being stored in MongoDB. JWT tokens are configured with a 7-day expiration.

## Reconstruction Workflow

```text
1. User logs in
        |
2. Frontend receives JWT
        |
3. User uploads a 2D occlusal jaw image
        |
4. Node backend validates JWT and receives the image
        |
5. Original image is stored in MongoDB GridFS
        |
6. Image is forwarded to the Python AI API
        |
7. Python service creates a reconstruction job
        |
8. Frontend polls /status/:jobId
        |
9. AI pipeline generates a 3D STL model
        |
10. Backend can persist the STL in GridFS
        |
11. User downloads and visualizes the STL model
```

## Data Storage

MongoDB is used for:

### Users

Stores:

- Email
- Hashed password
- Name
- Creation and update timestamps

### Reconstruction Jobs

Stores:

- Associated user ID
- Uploaded image GridFS ID
- Generated STL GridFS ID
- Original filename
- Python reconstruction job ID
- Job status
- Error information
- Processing parameters
- Timestamps

### GridFS

GridFS is used for storing files such as:

- Uploaded dental images
- Generated STL models

## CORS

The backend enables CORS support to allow requests from frontend deployments:

```javascript
cors({
  origin: true,
  credentials: true
})
```

This allows the frontend to communicate with the API across different origins.

## Project Structure

```text
TeethNet-backend/
├── auth.js
├── db.js
├── gridfs.js
├── server.js
├── package.json
├── Dockerfile
├── .gitignore
└── README.md
```

The main API server and active route definitions are implemented in `server.js`.

## Production Considerations

For production deployment:

- Use a strong `JWT_SECRET`.
- Store environment variables securely.
- Use a production MongoDB deployment.
- Restrict CORS to trusted frontend origins where appropriate.
- Enable HTTPS.
- Add request rate limiting for authentication endpoints.
- Consider file type and upload size validation.
- Run the backend and Python AI service using container orchestration.

## Troubleshooting

| Issue | Possible Fix |
|---|---|
| MongoDB connection fails | Verify `MONGODB_URI` and database network access settings. |
| Authentication returns `missing token` | Send `Authorization: Bearer <token>`. |
| Authentication returns `invalid token` | Verify `JWT_SECRET` and token validity. |
| Upload fails | Ensure the request uses `multipart/form-data` with the field name `image`. |
| Python service cannot be reached | Verify `PYTHON_URL` and ensure the Python API is running. |
| Job status fails | Confirm the Python API exposes `/status/:jobId`. |
| STL download fails | Confirm the job completed successfully and `/download/:jobId` is available. |
| GridFS storage unavailable | Verify MongoDB connectivity and backend database configuration. |
| CORS errors | Verify the frontend origin and production CORS configuration. |

## License

Internal project scaffold. Customize freely.
