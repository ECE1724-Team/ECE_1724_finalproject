# ECE_1724_finalproject

## PDF storage: Cloudflare R2

Resume PDFs use a private Cloudflare R2 bucket through its S3-compatible API. The backend checks file ownership before streaming a PDF to the browser; extracted text and metadata stay in PostgreSQL.

1. Create a private R2 bucket. Keep public access via `r2.dev` and public custom domains disabled.
2. Create R2 S3 credentials with object read/write permissions scoped to that bucket. Keep credentials on the backend only.
3. Set the variables listed in `backend/.env.example`: `R2_ENDPOINT` (normally `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`), `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_REGION=auto`. Use the endpoint shown for your bucket.

`R2_PUBLIC_BASE_URL` is not needed: the intended browser access path is the authenticated backend file endpoint. The R2 adapter, worker-based PDF extraction, and resume PDF policy are implemented independently of HTTP and database integration. See [backend setup and handoff](backend/README.md) for configuration, module usage, and manual verification commands. Authentication, routes, persistence, and durable cleanup remain later integration work.
