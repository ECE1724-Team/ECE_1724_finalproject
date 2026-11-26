// Fictional demo data for `npm run seed`. Companies, people and URLs are made up.
//
// `resume` names a file in the resume folder by a keyword of its file name; `ai: true` also
// creates the application's AI workspace. `path` is the status history, oldest first.
// Interview times are days from today (local time), so the Dashboard's "next 7 days" always has
// some. `daysAgo` sets the applied date. Lists show applications in this order (the three AI
// workspaces first).

export const resumes = [
  { key: "Software_Engineer", name: "Avery Whitlock - Software Engineer" },
  { key: "Machine_Learning_Engineer", name: "Avery Whitlock - Machine Learning Engineer" },
  // An image-only PDF: stored and linkable, but its text cannot be read.
  { key: "Data_Engineer", name: "Avery Whitlock - Data Engineer" },
];

// AI workspace 1: every material, including a resume the AI can read.
const harborline = {
  companyName: "Harborline Freight",
  jobTitle: "Software Engineer, Backend Platform",
  path: ["applied", "oa", "interview"],
  daysAgo: 21,
  resume: "Software_Engineer",
  ai: true,
  jobUrl: "https://harborline.example.com/careers/backend-platform",
  companyWebsiteUrl: "https://harborline.example.com",
  companyNotes: `Harborline runs a freight-matching marketplace for mid-size carriers in Western Canada (Calgary HQ, about 300 people).
The backend platform team (7 engineers) owns shipment search, booking and the event pipeline.
Recruiter said the loop is: recruiter screen, a 60-minute technical interview (API design plus SQL), then a behavioral interview with the hiring manager.
They care a lot about reliability: their booking API had a public outage last spring caused by duplicate retries.`,
  notes: "Recruiter: Priya. Ask about on-call load and remote days.",
  interviews: [
    { type: "Recruiter screen", days: -6, hour: 10 },
    { type: "Technical interview", days: 2, hour: 14 },
  ],
  jobDescription: `About the role
Harborline Freight connects shippers with carriers across Western Canada. As a Software Engineer on the Backend Platform team, you will build and operate the services behind shipment search, booking and tracking, used by 4,000 carriers and our internal operations team.

What you will do
- Design, build and own Python and Go services behind our booking and shipment-tracking APIs.
- Model data in PostgreSQL and tune queries and indexes for search endpoints with strict latency targets (p95 under 200 ms).
- Make write paths safe under retries: idempotency keys, transactional state changes and clear error contracts.
- Publish domain events to Kafka and build consumers that keep search and notifications in sync.
- Add tracing, metrics and alerts with OpenTelemetry and Prometheus, and take part in a weekly on-call rotation.
- Review code, write design documents and help improve our testing and CI practices.

What we are looking for
- 2+ years building backend services in production with Python, Go or a similar language.
- Strong SQL and PostgreSQL experience, including query plans, indexing and transactions.
- Experience designing REST APIs and reasoning about concurrency, retries and consistency.
- Comfort with Docker and CI/CD (we use GitHub Actions); Kubernetes experience is a plus.
- Clear written communication and ownership of what you ship.

Nice to have
- Kafka or another event-streaming system.
- Experience in logistics, marketplaces or other operations-heavy domains.
- Frontend experience with React and TypeScript for internal tools.

Compensation and location
$105,000 - $130,000 CAD plus equity. Hybrid in Calgary (two days a week in the office) or remote within Canada.`,
};

// AI workspace 2: every material except a resume.
const northstar = {
  companyName: "Northstar Retail Labs",
  jobTitle: "Machine Learning Engineer",
  path: ["applied"],
  daysAgo: 9,
  ai: true,
  jobUrl: "https://northstar-retail.example.com/jobs/ml-engineer",
  companyWebsiteUrl: "https://northstar-retail.example.com",
  companyNotes: `Northstar builds demand-forecasting and pricing software for grocery chains (about 120 people, Toronto and Calgary offices).
The ML team has 5 people; models run as daily batch jobs on GCP.
A friend on the team said they are moving from notebooks to a proper feature store and MLflow-based releases this year.`,
  notes: "Applied through referral (Jordan). Haven't decided which resume to send for the follow-up.",
  jobDescription: `About Northstar
Northstar Retail Labs helps grocery retailers decide what to stock and how to price it. Our forecasts drive replenishment for more than 900 stores.

The role
We are hiring a Machine Learning Engineer to take models from experiment to reliable production systems. You will work with data scientists, data engineers and product managers on forecasting, anomaly detection and pricing models.

Responsibilities
- Build and maintain training and batch-inference pipelines in Python on GCP (BigQuery, Cloud Storage, Vertex AI).
- Turn research code into tested, versioned, reproducible jobs; track experiments and releases in MLflow.
- Design point-in-time-correct features and data-quality checks that prevent leakage.
- Serve model outputs through FastAPI services and monitor drift, freshness and model performance by store and category.
- Run backtests and A/B analyses, and explain results to non-technical stakeholders.

Requirements
- 2+ years of experience shipping ML models or data products to production.
- Strong Python and SQL; experience with pandas, scikit-learn or XGBoost; PyTorch is a plus.
- Solid understanding of evaluation for time-series problems (rolling-origin validation, leakage, baselines).
- Experience with Docker, CI/CD and monitoring.
- Ability to communicate trade-offs clearly in writing.

Nice to have
- Retail, supply-chain or forecasting experience.
- Experience with feature stores or MLOps platforms.

Location and pay
Hybrid (Toronto or Calgary) or remote in Canada. $115,000 - $140,000 CAD.`,
};

// AI workspace 3: every material, but the linked resume is an image-only PDF.
const prairieGrid = {
  companyName: "Prairie Grid Energy",
  jobTitle: "Data Engineer",
  path: ["applied", "oa"],
  daysAgo: 14,
  resume: "Data_Engineer",
  ai: true,
  jobUrl: "https://prairiegrid.example.com/careers/data-engineer",
  companyWebsiteUrl: "https://prairiegrid.example.com",
  companyNotes: `Prairie Grid operates wind and solar sites in Alberta and Saskatchewan and sells forecasting data to grid operators.
The data platform team is 4 people and reports to the VP of Operations.
The online assessment is a 90-minute SQL and Python take-home on sensor data.`,
  notes: "OA link expires this week.",
  interviews: [{ type: "Online assessment", days: 1, hour: 9 }],
  jobDescription: `About us
Prairie Grid Energy operates 30 renewable-energy sites and turns sensor and market data into production forecasts for grid operators.

The role
As a Data Engineer, you will build the pipelines that bring turbine telemetry, weather forecasts and market prices into our warehouse, and keep them reliable enough for real-time trading decisions.

What you will do
- Build batch and streaming pipelines in Python and SQL (Airflow, dbt, Kafka) into BigQuery.
- Model time-series data for analytics and forecasting, including late-arriving and corrected readings.
- Add data-quality tests, lineage and alerting so issues are caught before they reach forecasts.
- Optimize warehouse cost and query performance as data volume grows (about 2 TB per month).
- Work with analysts and ML engineers to define datasets and service-level expectations.

Requirements
- 2+ years of data engineering or backend experience.
- Strong SQL and Python; experience with Airflow or a similar orchestrator.
- Experience with a cloud data warehouse (BigQuery, Snowflake or Redshift).
- Understanding of data modeling, partitioning and incremental processing.
- Comfort with Docker, Git and CI.

Nice to have
- dbt, Kafka or other streaming tools.
- Experience with IoT, energy or other time-series-heavy domains.

Location and pay
Calgary, hybrid. $95,000 - $120,000 CAD.`,
};

export const applications = [
  harborline,
  northstar,
  prairieGrid,
  {
    companyName: "Northwind Robotics", jobTitle: "Backend Engineer", path: ["applied", "interview", "offer"], daysAgo: 40,
    resume: "Software_Engineer", jobDescription: "Go and PostgreSQL services for warehouse robot fleets; on-call rotation.",
    companyWebsiteUrl: "https://northwind-robotics.example.com", notes: "Offer received. Deadline to respond next Friday.",
    interviews: [{ type: "Technical interview", days: -20, hour: 13 }, { type: "Onsite", days: -12, hour: 10 }],
  },
  {
    companyName: "Silverleaf Insurance", jobTitle: "Software Developer", path: ["applied", "interview", "offer", "rejected"], daysAgo: 45,
    resume: "Software_Engineer", jobDescription: "Java and React developer for the claims platform.",
    notes: "Declined the offer: fully in-office and below range.",
    interviews: [{ type: "Panel interview", days: -25, hour: 11 }],
  },
  {
    companyName: "Quill Payments", jobTitle: "Software Engineer II", path: ["applied", "oa", "interview"], daysAgo: 18,
    resume: "Software_Engineer", jobDescription: "Payment APIs with strong consistency requirements; TypeScript and PostgreSQL.",
    interviews: [{ type: "System design interview", days: 4, hour: 15, minute: 30 }],
  },
  {
    companyName: "Riverbend Media", jobTitle: "Data Platform Engineer", path: ["applied", "interview"], daysAgo: 16,
    jobDescription: "Streaming analytics for a video platform: Kafka, Flink and BigQuery.",
    interviews: [{ type: "Hiring manager interview", days: 6, hour: 11 }],
  },
  {
    companyName: "Brightpath Learning", jobTitle: "Full-Stack Developer", path: ["applied", "interview", "rejected"], daysAgo: 35,
    resume: "Software_Engineer", jobDescription: "React and Django for an online tutoring platform.",
    interviews: [{ type: "Technical interview", days: -15, hour: 16 }],
  },
  {
    companyName: "Orbitly", jobTitle: "Machine Learning Engineer Intern", path: ["applied", "rejected"], daysAgo: 30,
    resume: "Machine_Learning_Engineer", jobDescription: "Recommendation models for a travel app; Python and PyTorch.",
  },
  {
    companyName: "Lumen Retail", jobTitle: "Analytics Engineer", path: ["applied", "oa"], daysAgo: 11,
    resume: "Machine_Learning_Engineer", jobDescription: "dbt models and dashboards for retail analytics.",
  },
  {
    companyName: "Atlas Cloud Systems", jobTitle: "Site Reliability Engineer", path: ["applied"], daysAgo: 7,
    resume: "Software_Engineer", jobDescription: "Kubernetes, Terraform and incident response for a hosting provider.",
  },
  {
    companyName: "Copperline Games", jobTitle: "Backend Developer", path: ["applied"], daysAgo: 5,
    jobDescription: "Game services in Go: matchmaking, leaderboards and player inventory.",
  },
  {
    companyName: "Pinecrest Bank", jobTitle: "Data Analyst", path: ["saved"], daysAgo: 4,
    jobDescription: "SQL reporting and Tableau dashboards for retail banking.",
  },
  {
    companyName: "Verdant Health", jobTitle: "Platform Engineer", path: ["saved"], daysAgo: 3,
    notes: "Waiting for a referral before applying.",
  },
  {
    companyName: "Glacier Mobility", jobTitle: "Junior Software Engineer", path: ["saved"], daysAgo: 1,
    companyWebsiteUrl: "https://glacier-mobility.example.com",
  },
];
