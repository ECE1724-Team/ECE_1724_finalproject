# JobFlow AI: Job Application Management with an AI Assistant

## 1\. Motivation

JobFlow AI is designed for university students, recent graduates, and early-career professionals applying for internships or full-time positions. These users often manage several opportunities with different job requirements, resume versions, application statuses, and interview schedules. When records and preparation materials are spread across spreadsheets, folders, and AI conversations, it becomes difficult to track progress and identify the materials associated with each application. The project addresses this organizational burden and the repeated setup required for role-specific interview preparation.

This problem matters because interview preparation depends on understanding both the role and what the candidate previously submitted. An invitation may arrive weeks after an application, requiring the user to reconstruct that context before practising. Reducing this effort would leave more time for reviewing relevant experience and improving answers. Keeping previous practice and feedback accessible would also help users build on earlier preparation instead of repeatedly starting over.

Spreadsheets can organize applications, but summary views may require additional setup and maintenance. When used alongside standalone AI chats, users must also connect their application records with the relevant conversations and supply background materials when starting new practice. JobFlow AI aims to reduce this coordination through a ready-to-use application overview and AI conversations linked to saved role-specific materials.

## 2\. Objectives, Architecture, and Key Features

### 2.1 Main Project Objectives and Core Functionality

JobFlow AI aims to help users understand their overall job-search progress, manage individual applications, and prepare for each opportunity using the materials already saved for that role. The application will provide three main modules:

**Application Dashboard.** The dashboard will be the first page users see after logging in. It will summarize application, interview, and offer counts, show applications by status, and highlight upcoming interviews. Users will be able to understand their progress without manually building spreadsheet formulas or summary charts.

**Application Management.** Users will create applications and browse them in a list, with each entry prominently displaying the company and position so that opportunities are easy to distinguish. Opening an entry will show an editable detail page containing the job description, application status, dates, company website URL, company background notes, personal notes, and associated resume. Users will be able to upload or select a different resume version, update interview arrangements, and review the application's activity timeline. Each detail page will also provide a button that opens the AI conversation interface for that application.

**AI Interview Copilot.** Each application will have a dedicated workspace containing multiple independent conversations, such as resume advice, interview practice, and individual mock interviews. Conversations within a workspace will share access to saved application materials: the resume, JD, company, position, website URL, and company notes. Each conversation will retain its own messages; neither another conversation's history nor another application's materials will be included automatically. Users can start a fresh conversation without re-uploading the shared materials. Company website reading on request or for company-related questions is optional, time permitting. Resume suggestions, contextual follow-up questions, and saved feedback will support continued preparation.

### 2.2 Architecture and Technology Choices

We will use a separate frontend and backend architecture, with a React client communicating with an Express server through RESTful APIs.

- **Frontend:** React and TypeScript for pages and interactions; Tailwind CSS and shadcn/ui for responsive layouts and reusable components.  
- **Backend:** Node.js, Express.js, and TypeScript for authentication, validation, business rules, file processing, and AI orchestration.  
- **Database:** PostgreSQL, accessed through \`pg\` using parameterized SQL, with \`node-pg-migrate\` for versioned database migrations.  
- **File storage and processing (Advanced Feature):** Private S3-compatible object storage for resume PDFs, with PDF validation and text extraction for AI use. Basic upload/download satisfies the core storage requirement; file processing is the advanced feature.  
- **AI integration (Advanced Feature):** Vercel AI SDK for an external LLM connection, bounded tool calling, multi-turn conversations, and streamed responses.  
- **Authentication and authorization (Advanced Feature):** Authentication and session management using Better Auth with PostgreSQL-backed sessions and Secure, HttpOnly cookies. Protected resources will be secured through user authentication and ownership checks to ensure users can only access their own data.  
- **API documentation:** An OpenAPI specification describing requests, responses, authentication, and errors.

### 2.3 Design Rationale, Project Fit, and Tradeoffs

TypeScript across React and Express supports consistent data definitions. React supports reusable dashboard, application-list, and chat components; Tailwind CSS and shadcn/ui reduce styling and component-development effort. A single Express backend keeps application management, authorization, and file handling together. PostgreSQL fits our linked application, resume, and conversation records and supports transactional timeline updates. We use `pg` without an ORM because our team is more familiar with SQL and prefers writing queries directly, making development more straightforward and efficient for us.

We chose the Vercel AI SDK because its TypeScript backend APIs and React hooks (`@ai-sdk/react`) simplify tool calling, streaming, and chat-state handling, reducing integration work compared with implementing provider calls and stream handling ourselves. RAG, coding interviews with code execution, automatic grading, and voice interviews are outside the current project scope, keeping the design manageable. The SDK's common provider interface supports later model changes, although provider capabilities and SDK upgrades still require compatibility checks.

## 3\. Project Plan and Team Responsibilities

### Project Plan

#### Phase 1: Confirm Requirements and Design

1. **Define requirements — Jianye Zhou:** Draft the PRD, including core features, pages, permissions, and acceptance criteria.  
2. **Design the database — Rongxin Bi:** Define entities, relationships, constraints, and migrations, including application, resume, and conversation records.  
3. **Define API contracts — Justin Smith:** Document endpoints, request/response formats, and errors.  
4. **Define the Project Structure — Jianye Zhou:** Document the folder structure and organization of frontend code, backend code, database migrations, and project documentation.

#### Phase 2: Build Core Components and the AI Prototype

1. **Backend and database — Zishi Yang and Rongxin Bi:** Zishi implements authentication and application creation/query endpoints; Rongxin initializes the database and supporting SQL operations.  
2. **Frontend — Justin Smith:** Build login, application creation, and application-list pages, using mock data until endpoints are available.  
3. **AI prototype — Jianye Zhou:** Independently verify tool calling and streaming chat using sample application materials.

#### Phase 3: Complete the First End-to-End Workflow (Non-AI features planned for completion before November 25\)

1. **Application features — Zishi Yang, Rongxin Bi, and Justin Smith:** Implement editing, deletion, search/filtering, status history, and dashboard statistics. Zishi owns API logic, Rongxin owns database operations, and Justin owns the corresponding pages.  
2. **Resume handling — Jianye Zhou, supported by Rongxin Bi:** Implement cloud upload/download, PDF parsing, and resume-version associations. Justin integrates resume controls into application details.  
3. **Integration checkpoint — All members:** Verify the complete non-AI application, including registration, login, ownership checks, application CRUD, search/filtering, status history, dashboard statistics, and resume upload/download. Confirm that uploaded resumes are associated with the correct applications and displayed with their parsing status. All core non-AI features must work together through the completed frontend and backend.

#### Phase 4: Integrate the AI Workspace

1. **Connect real data — Jianye Zhou:** Implement the AI frontend and backend using authenticated application data, independent conversations, and persistent chat history. Rongxin supports database integration.  
2. **Implement context management — Jianye Zhou:** Add initial material retrieval, selective refresh after updates, and isolation between applications and conversations.  
3. **Complete supporting features — Jianye Zhou:** Add editable prompt shortcuts and on-demand company website reading (optional, time permitting).  
4. **Integration checkpoint — All members:** Verify saved conversations, updated-material handling, and isolation using distinct users and applications.

#### Phase 5: Validate and Prepare Delivery

1. **Test and fix — All members:** Review one another’s features against the PRD, including access controls, upload failures, interrupted AI responses, and responsive layouts. Each feature owner fixes identified issues.  
2. **Prepare documentation — Justin Smith and Rongxin Bi:** Justin finalizes API and startup documentation; Rongxin documents database setup and migrations. All members contribute module-specific instructions and required project records.  
3. **Verify delivery — All members:** Have a teammate run the application from a clean environment and rehearse the demonstration. Jianye adds optional Docker packaging only if core features are stable and time permits.

#### Collaboration and Risk Management

The team will hold brief twice-weekly progress checks, communicate blockers promptly, and review small changes before merging. API or schema changes must be communicated to affected members and reflected in the documentation. Integration will occur at each checkpoint. If progress falls behind, optional website-browsing capabilities, visual refinements, and Docker packaging will be deferred to protect the core application and AI workflow.

### Team Responsibilities

#### Zishi Yang

- **Authentication and Authorization (Advanced Feature):** Own user authentication and resource ownership checks, including logout and protected API access.  
- **Application CRUD:** Implement application endpoints, with input validation and consistent error handling.

#### Justin Smith

- **Frontend Development:** Own all non-AI frontend pages, including responsive layouts and API integration.  
- **API Documentation:** Maintain the OpenAPI specification and coordinate with backend contributors to keep it consistent with implementation.

#### Rongxin Bi

- **Database Documentation:** Maintain documentation of the schema, relationships, constraints, and data access patterns.  
- **Database Initialization:** Initialize PostgreSQL and manage schema migrations with `node-pg-migrate`.  
- **Database CRUD:** Implement parameterized SQL operations and coordinate database changes with Zishi Yang.

#### Jianye Zhou

- **Product Requirements Document:** Maintain the PRD and keep requirements aligned with the agreed project scope.  
- **AI Frontend and Backend (Advanced Feature):** Own the AI workspace frontend and backend, using the Vercel AI SDK for model integration.  
- **Cloud Storage and File Processing (Advanced Feature):** Integrate S3-compatible storage and PDF processing. Validate uploaded PDFs and make extracted text available to the AI through the associated database records.

## 4\. Initial Team Reasoning and AI-Assisted Exploration

#### 4.1 Initial Team Reasoning

**Problem framing:** We reviewed the course examples and drew on our own job-search experiences to develop the idea for JobFlow AI. We wanted to help users keep track of applications and prepare for interviews using the materials associated with each role. Our initial proposal combined the required full-stack functionality with authentication and authorization, resume storage and processing, and AI assistance. Authentication would identify users, while authorization would protect their records. File handling would support PDF resumes, and AI would provide resume advice and interview practice.

**Initial technical hypothesis:** We initially favored separate React and Express applications so frontend and backend work could proceed in parallel. Some members were also more comfortable with backend development. We preferred PostgreSQL because we expected multiple users to update applications and save conversations concurrently. Following the course recommendation, we considered Better Auth to reduce the work involved in implementing authentication ourselves. We also planned to store PDF files in private S3-compatible object storage, with the provider still to be selected.

**Open questions:** We had not yet settled how much the AI assistant should do. Tool calling, conversation memory, and the work needed to implement them required further investigation.

#### 4.2 Exploration and Evaluation

Our group discussed several ideas before choosing JobFlow AI. We first considered a health monitoring system, but thought it would amount to a basic CRUD application. The collaborative data analysis example interested us, although we felt its scope would be difficult to manage within the available time. A job application tracking system drew on our own experiences and seemed more achievable while still giving us room to explore AI integration.

After that discussion, we asked ChatGPT which technologies could support the AI Interview Copilot. Its suggestions included guardrails, state management, and RAG. Given the time available, we decided to focus on tool calling, context management, and short-term conversation memory. These would support the basic assistant we wanted to build without adding RAG to the project scope.  
