---
artifact: prd
version: "1.1"
created: 2026-11-08
status: approved-with-open-items
---

# JobFlow AI Product Requirements Document (PRD)

This document specifies the deliverables for the complete course project and is intended for the team and coding agents. It does not claim that the features have been implemented. It is based on the Proposal, AI Design, and the user's confirmations on 2026-11-08; these confirmations supersede the corresponding earlier descriptions in the source documents. The user has approved the current interactive prototype. The Dashboard, application list, creation/editing forms, resume dialog, and AI entry points form the approved implementation baseline. Section 11 retains only the technical and business details not resolved by the prototype; these open items do not invalidate the confirmed scope.

**Confirmed scope:** Registration, logout, deletion, search/filtering, and status history; a personal resume library with files reusable across applications and at most one linked resume per application; email-and-password authentication with email verification and password reset; resume deletion that removes all related application links; all recommendations in AI Design §6; continued assistance with limitations explained when materials are insufficient; AI behavior guided through system prompts without a complex constraint framework; support for Chrome, Edge, and concurrent users, without numerical performance targets.

**File rules established under the user's authorization:** At most 2 pages and 2 MiB (2,097,152 bytes) per file. See §5.2 for text-based PDF validation, §5.5 for pages, fields, and navigation, and §11 for remaining open items.

## 1. Overview

### 1.1 Problem and Motivation

University students, recent graduates, and early-career job seekers often apply to multiple internships or full-time positions at the same time. Job descriptions (JDs), resume versions, application statuses, interview arrangements, and preparation materials are scattered across spreadsheets, folders, and separate AI chats. Maintaining records and connecting them to the right materials requires repeated manual work.

An interview invitation may arrive weeks after an application. Users must find the resume and job information they submitted, then provide that context to the AI again before practising. Previous practice and feedback are also difficult to accumulate and revisit by position.

JobFlow AI connects application management with role-specific AI preparation to reduce the effort of finding materials, reconstructing context, and uploading the same files repeatedly. This is a full-stack course project. Non-AI features are planned for completion before November 25, 2026; the final deadline is not currently set.

### 1.2 Solution Summary

The product has three connected modules:

1. **Application Dashboard:** The landing page after login. It displays total applications, interview sessions, offers ever received, a status distribution, and an upcoming-interview list clearly labeled "Next 7 days." Saved positions that have not yet been applied to, and rejected applications, are both included in the application total.
2. **Application Management:** Opens with the current application list. Controls above the list provide filtering, application creation, and a central resume entry point. The resume entry opens a dialog for drag-and-drop upload, naming files at upload, viewing, and deletion. Opening an application takes the user to a separate detail page where it can be freely edited.
3. **AI Interview Copilot:** Has its own navigation entry. Users entering directly first search/filter existing applications from Application Management and select a position, then enter that application's workspace to create or continue independent conversations. Entering through a position-specific AI action in the Dashboard or application management automatically selects the application and creates or reuses its workspace. Conversations share the application's materials, while their chat histories are stored separately.

### 1.3 Target Users and Access Boundaries

- Target users: University students, recent graduates, and early-career job seekers applying for internships or full-time positions.
- Confirmed access rules: Authenticated users can access only their own applications, files, and conversations. Workspace materials are available only to conversations belonging to that application.
- The sources do not define administrator, recruiter, or collaborative-sharing roles. This document does not add those roles or permissions.
- No research data is available for personas, usage frequency, or scale. Demographic characteristics and daily-active-user projections are not invented.

## 2. Goals & Success Metrics

### 2.1 Product Goals

1. Give users a direct view of overall application progress and upcoming interviews.
2. Connect each application to its JD, resume, company information, interview arrangements, and activity history.
3. Use saved role-specific materials when starting a new AI conversation, reducing repeated context setup.
4. Preserve independent conversations and feedback, and continue preparation using the latest materials after updates.
5. Maintain access and context isolation between users, application workspaces, and conversations.

### 2.2 Success Metrics and Acceptance Evidence

Acceptance for this release focuses on functioning core workflows, correctness, data isolation, and usable AI assistance. There are no hard numerical targets for business growth, response time, or concurrent-user count. No measured baseline exists. Passing functional checks is not treated as proof of improved user efficiency.

| Type | Metric or Acceptance Observation | Current Baseline | Target / Pass Criterion | Timing |
|---|---|---|---|---|
| Product outcome | Fewer steps spent finding and repeatedly supplying preparation materials | Not measured | Demonstrate starting a new conversation directly from saved materials; no time target | AI integration checkpoint |
| Product outcome | Need to upload already linked materials again for a new conversation | Not measured | Saved, available materials require no re-upload; verify through FR-11 and FR-13 | AI integration checkpoint; date not set |
| Functional correctness | Consistency between Dashboard summaries and underlying application records | Not verified | Saved but unapplied and rejected records count toward applications; interviews count by session, offers by historical receipt, and the upcoming list covers the next 7 days | Before 2026-11-25 |
| Functional correctness | Material versions used when continuing a conversation | Not verified | Version scenarios in FR-14 through FR-16 behave as specified | AI integration checkpoint; date not set |
| Permissions and isolation | Cross-user access, cross-application retrieval, and unrelated conversation history entering context | Not verified | Every defined unauthorized-access/isolation case satisfies FR-02 and FR-12; this does not establish a production failure rate | Integration and delivery checkpoints |
| AI quality | Role-relevant answers, correct use of current materials, and retention of important history | Not evaluated | Lightweight manual checks under Section 6; no additional evaluation platform or accuracy metric required | Before final acceptance |

### 2.3 Non-Goals

Under Proposal §2.3, this release does not target RAG, coding interviews with code execution, automatic grading, or voice interviews.

Under AI Design §2, mock interviews take place through chat. There is no separate start/end workflow, report page, or feedback table. In-chat summaries, feedback, and review suggestions remain in scope.

## 3. User Stories

All core capabilities in this release must be delivered. Web search, website reading, and Docker packaging are optional. No additional P0/P1 ranking is invented.

| ID | User Story | Related Requirements |
|---|---|---|
| US-01 | As a job seeker, I want to see overall application progress and upcoming interviews after login so I can plan my next steps. | FR-01, FR-03 |
| US-02 | As a job seeker, I want to distinguish applications by company and position and maintain the information for each role. | FR-04 through FR-06 |
| US-03 | As a job seeker, I want to link the resume version used for a position and review interview arrangements and activity history. | FR-07 through FR-09 |
| US-04 | As a job seeker, I want to select a saved position from the standalone AI entry or enter its workspace directly from an application, then create/continue a conversation using that position's materials. | FR-10, FR-13, FR-35 |
| US-05 | As a job seeker, I want separate conversations for resume advice and different mock interviews while retaining previous records. | FR-11, FR-12, FR-18 through FR-20 |
| US-06 | As a job seeker, I want to continue an existing conversation after updating the JD or resume and receive advice based on the new materials. | FR-14 through FR-16 |
| US-07 | As a job seeker, I want to continue a long practice conversation while retaining access to its full history. | FR-17, FR-19 |
| US-08 | As a user, I want my applications, resumes, and chats to remain inaccessible to other users. | FR-02 |
| US-09 | As a job seeker, I want to upload resumes centrally, reuse them across applications, and retain them after deleting an application. | FR-08, FR-22, FR-26 |
| US-10 | As a job seeker, I want to search, filter, and delete applications and review their status changes. | FR-22 through FR-24 |
| US-11 | As a user, I want to verify my email and reset a forgotten password through email. | FR-21, FR-32, FR-33 |
| US-12 | As a user, I want to delete resumes I no longer need while keeping my application records. | FR-34 |

## 4. Scope

### 4.1 In Scope

- Email-and-password registration/login, email verification, password reset, logout, session management, and ownership checks.
- Dashboard summaries, status distribution, and interviews in the next 7 days; unapplied and rejected records count toward total applications.
- Application creation, listing, editing, deletion, search/filtering, and status history; details include dates, company information, personal notes, interview arrangements, and an activity timeline.
- A central resume entry and dialog above the Application Management list: drag-and-drop upload, naming at upload, browsing uploaded files, PDF viewing, downloading, and deletion; files reusable across applications, at most one linked resume per application, visible parsing status, and removal of related application links when a file is deleted.
- Standalone AI Interview Copilot navigation with search/filtering and selection of existing applications; one AI workspace per application, multiple independent conversations created by the user, persistent messages, and streamed responses.
- Resume advice, interview practice, chat-based mock interviews, and feedback on request using the current application's materials.
- Initial material retrieval, version checks before every message, selective refresh, and historical material-version records.
- Current materials kept outside the chat-history window; older history compressed into summaries while full history remains stored.
- Responsive interfaces, separate frontend and backend, and OpenAPI documentation.

### 4.2 Confirmed Operations and Error Handling

- Shortcuts prefill prompts for users to edit before sending; no additional prompt-management system.
- A new resume can replace an application's current link only after successful parsing. On failure, show the reason and retain the original valid link.
- A response uses the material versions confirmed at the start of generation. Changes made during generation take effect on the next turn.
- Deleting or unlinking materials counts as an update; those materials must no longer be treated as current sources.
- Show material-sync and failure notices; allow retries after interrupted streaming; permit only one generation at a time per conversation.
- Insufficient materials do not block chat. Explain the limitations and continue helping with the available information.

### 4.3 Explicitly Out of Scope

- RAG, code execution, automatic grading, and voice interviews.
- OCR for scanned resumes and complex AI moderation, scoring, or blocking systems.
- Editing uploaded resume contents, overwriting a file in place, or renaming after upload; new versions are uploaded separately and then linked.
- A separate mock-interview start/end workflow, report page, or feedback table.
- Automatically including another application's materials or another conversation's chat history in the current answer.
- Replacing existing database material records with additional Markdown files or duplicate material-memory fields.

### 4.4 Future / Optional Capabilities

- Agent web search and company-website reading may be considered if time permits; neither is a core acceptance requirement for this release.
- If website reading is implemented, trigger it only on an explicit user request or when a company-related question requires website information. Retain the source URL and retrieval time, clearly report failures, and retrieve again when current information is needed.
- Rules for following links within a website and the maximum pages per request remain undecided.
- Docker packaging is optional, to be considered only after core functionality is stable and time permits.

## 5. Solution Design

### 5.1 Functional Requirements and Acceptance Methods

The checks below define how to verify functionality; they do not indicate that tests have passed. The executor must provide check results. Section 8 defines manual acceptance responsibilities and escalation for open items.

#### A. Accounts, Permissions, and Dashboard

| ID | Requirement | Acceptance Method | Source / Open Items |
|---|---|---|---|
| FR-01 | Users land on the Dashboard after login; the server manages authentication sessions. | Complete login and check the landing page; unauthenticated requests cannot read protected data. | Proposal §2.1–2.2; email-and-password authentication confirmed by the user |
| FR-02 | Protected operations check user ownership. AI requests check the relationships among the user, application workspace, and conversation. Changing an ID must not grant access to another user's or another application's materials. | Use different users and applications to check reads and updates for applications, files, and conversations; reject forged workspace/conversation IDs. | Proposal §2.2; AI Design §5; specific error responses remain open |
| FR-03 | The Dashboard shows total applications, total interview sessions, offers ever received, a clickable status distribution, interviews in the next 7 days, and recent applications. Unapplied/rejected records count toward applications; each interview round counts separately; later declining an offer does not erase its receipt. | Check totals; three interviews for one application count as 3, and a later-declined offer still counts. The upcoming list includes only the 7 calendar days starting today, in chronological order. Clicking a status opens the filtered list; clicking a position opens its details. | Prototype confirmed by the user; rules in §5.5 |

#### B. Application and Resume Management

| ID | Requirement | Acceptance Method | Source / Open Items |
|---|---|---|---|
| FR-04 | Both the Dashboard and application list offer "Add application," opening a separate creation page. Only company and position are required; status defaults to Saved, and other information can be added later. Saving returns to the list with new records first; cancelling returns without creating a record. | Save with only company and position, then confirm persistence after reload. Missing either required field prevents saving and shows a message. An unfilled application date stays empty; cancelling adds no record. | Prototype and creation form confirmed; field table in §5.5 |
| FR-05 | Application Management opens with the application list. Controls above it provide company/position search, status filters, sorting, application creation, and resume management. The list shows company/position, status, application date, and linked resume. Clicking the company or the open button at the end of a row opens a separate detail page. | Check the list, controls, and columns; verify correct navigation for multiple applications. Show an empty state when nothing matches. On narrow screens, prioritize company/position and status; other information remains available in details. | Prototype layout and navigation confirmed by the user |
| FR-06 | The separate detail page groups fields into basic information, job materials, additional information, and interview arrangements, with save, cancel, and delete controls. Users can freely edit their own applications without stage-based locking. Current status and "Offer previously received" are stored separately. | Edit, save, and reload fields; cancelling does not submit changes. Selecting Offer records receipt; changing to Rejected does not automatically clear it. Editing remains available after status changes. | Form confirmed by the user; required fields and statuses in §5.5 |
| FR-07 | A saved application's detail page supports adding, editing, and deleting individual interview arrangements, with interview type/name and date/time fields, and displays an activity timeline. The next interview is derived from individual records rather than maintained as a conflicting single Interview Date. | Save three interviews for one application, edit one, delete one, and verify after reload. Update session counts and the seven-day list accordingly. Status history reflects actual changes. | Prototype confirmed; required interview-field validation and other timeline events in §11 |
| FR-08 | Users centrally upload/download PDFs in their personal resume library. The same file can be reused across their own applications. Creation/editing selects an uploaded file, with at most one linked resume per application. Original files are held in private object storage. | Link one resume to two applications. Change the link for one and confirm the other is unchanged. Verify that each application has no more than one linked resume. | User confirmation; upload interaction and limits in FR-26 |
| FR-09 | The backend validates and parses PDFs and stores extracted text, parsing status, and version in the database. Subsequent AI requests read the saved text without downloading/parsing the PDF again. | Upload a PDF with extractable text and verify persisted content and version; check the retrieval path in subsequent chats. | Proposal §2.2; AI Design §3.2; FR-26 and FR-27 define validation and failure handling |

#### C. AI Workspaces and Context

| ID | Requirement | Acceptance Method | Source / Open Items |
|---|---|---|---|
| FR-10 | A position-specific AI entry in the Dashboard or Application Management carries the application identity into Copilot, skips position selection, and automatically creates or reuses that application's unique workspace. The detail-page header retains the "AI Interview Assistant" entry. The user clicks "New conversation" inside the workspace; entering does not automatically create the first conversation. Existing conversations can be continued. | Enter from different positions and check automatic selection and ownership. Create the workspace if absent, otherwise reuse it. Repeated entry adds neither workspaces nor conversations. A blank conversation appears only when the user creates one. Navigation does not call the model. | Latest user confirmation supersedes v1.0's automatic first-conversation creation; see §5.5 |
| FR-11 | An application workspace must be selected before a conversation is created. A user-created conversation starts with empty history and can access the selected workspace's saved materials. One application can have multiple independent conversations, with previous conversations retained. Switching positions opens another workspace without rebinding existing conversations. | Creating a conversation or sending a message is unavailable before position selection. Create two conversations in one workspace and verify shared materials and separate histories. Switching positions preserves the original conversation's ownership and allows returning to continue it. | AI Design §1 and latest user confirmation |
| FR-12 | The current conversation must not automatically include another conversation's history or another application's materials. Personal notes are not in the source documents' shared AI material list and must not be added to context without authorization. | Give different applications/conversations distinguishable materials and messages; inspect the actual assembled request context and retrieval results. | Proposal §2.1; AI Design §1 and §3.2 |
| FR-13 | On the first message in a conversation bound to an application, tools retrieve that application's current resume text, JD, company, position, company website URL, and company notes, saving tool results and material versions. Each conversation records its own retrievals; what is shared is the underlying material source. | Send messages after selecting a position through the standalone entry and after navigating from an application. Verify the application, materials, and versions used in actual tool calls. New conversations require no re-upload, and tool records are saved separately per conversation. | AI Design §1 and §3.1; missing materials handled under FR-30 |
| FR-14 | On every message, backend code compares current material versions with the versions already retrieved for that conversation; it does not rely on the model to notice updates. Reuse unchanged content and retrieve only changed materials. | Test no changes, resume-only changes, JD-only changes, both changed, and changes to other shared fields; inspect version checks and retrieval records. | AI Design §3.1; version granularity for individual fields remains to be implemented |
| FR-15 | Before responding, use the latest materials in the base context and tell the model which materials changed and that old content is only for understanding history. Update the conversation's retrieved-version records only after the new content is saved successfully. | Inspect updated context and save ordering. A write failure must not mark unsaved content as successfully retrieved. | AI Design §3.1; sync/failure notices in FR-29 |
| FR-16 | Historical messages and feedback remain unchanged after material updates, retaining the material versions they were based on. Versions must not be inferred only from message timestamps. Each conversation independently synchronizes when its next message is sent. | Have two conversations retrieve an old version, update the materials, then continue each in turn. Verify unchanged history, version associations, and independent synchronization. | AI Design §3.1 |
| FR-17 | Each answer's context includes current base materials, that conversation's compressed history, recent messages, and the current input. Base materials are excluded from the history sliding window and summary compression; full chat history remains in the database. | Trigger history compression and check that context still contains current materials and recent messages. Full records remain readable, and each summary belongs only to its own conversation. | AI Design §3.2; trigger thresholds, window size, and oversized-material handling require confirmation |

#### D. Chat and Preparation Activities

| ID | Requirement | Acceptance Method | Source / Open Items |
|---|---|---|---|
| FR-18 | Through free-form chat, users can request resume advice, interview practice, or HR/technical/behavioral mock interviews, including follow-up questions, summaries, and review suggestions. | Exercise each activity's user flow; evaluate model-output quality separately under Section 6. | AI Design §2; excludes code execution and automatic grading |
| FR-19 | Responses appear as a stream and are saved to the corresponding conversation when complete. User messages, AI messages, tool results, and feedback persist and can be revisited. | Observe streaming, then reopen the conversation after completion and verify saved content and ownership. | AI Design §1 and §5; interruption/retry is included in FR-29, while partial-message storage remains open |
| FR-20 | Feedback and summaries are stored as ordinary AI messages; no separate mock-interview state machine, report page, or feedback table is introduced. | Request feedback in chat and revisit it, confirming it appears in the current conversation. | AI Design §2 |

#### E. Additional Full-Project Features

| ID | Requirement | Acceptance Method | Source / Open Items |
|---|---|---|---|
| FR-21 | Users register/log in with email and password and can log out. Email verification and password reset are included in this release. | Complete registration and login; after logout, the previous session cannot access protected data. | Latest user confirmation; verification and reset in FR-32 and FR-33 |
| FR-22 | Users can delete their own applications from the separate detail page. Deletion removes the record from the list and updates the relevant current Dashboard totals. Resume-library files and other applications' links remain intact. | Check the list and totals after deletion; confirm that library files and another application reusing the file are unaffected. | Prototype interaction confirmed; underlying soft/hard deletion and chat retention in §11 |
| FR-23 | The list supports case-insensitive substring search by company or position. Status buttons cover All and the six statuses, each displaying its current count. Search and status filters apply together. Sorting supports newest first by default and company A–Z. | Search company/position fragments with different letter cases. Combine search with status filters and verify counts and empty results. Switch sorting; clearing search and selecting All restores the complete list. | Prototype search/filter/sort behavior confirmed by the user |
| FR-24 | Application statuses are Saved, Applied, OA, Interview, Offer, and Rejected, with Saved as the default. Users can freely change status; changes are retained chronologically in the detail-page activity timeline. | New records default to Saved. Both sequential and cross-stage changes can be saved. History and current status are correct; static placeholder text does not substitute for actual history. | Status set and unrestricted editing confirmed; other activity events in §11 |
| FR-25 | Chat shortcuts prefill requests that users can edit before sending; users can also type freely. | Clicking a shortcut does not send automatically. After editing, the submitted request uses the actual input. | AI Design §2; initial shortcuts may use the document's examples |

#### F. Resume Rules and AI Error Handling

| ID | Requirement | Acceptance Method | Source / Open Items |
|---|---|---|---|
| FR-26 | "Resume management" above the list opens a central dialog. Users name a resume at upload and select or drag in a PDF. The dialog lists uploaded names, file sizes, linked-application counts, and upload/parsing status, with view and delete actions. Closing returns to the original list. Uploaded files cannot be edited and can be linked only after successful validation/parsing. | Check naming, file-picker/drag-and-drop upload, success/failure notices, the list, and link counts. View the actual PDF, close/return to management, and check the number of links removed after deletion. No post-upload editing entry is present. Validate oversized, overlength, textless, and damaged files. | Prototype confirmed; production must perform actual upload/parsing/PDF reading; see §5.2 |
| FR-27 | A replacement resume must parse successfully first. On failure, retain the original link and show a failure notice. Uploading a new file alone does not replace other applications' links. | With V1 linked, a failed new upload leaves V1 in use. After successful parsing and selection of V2, only the target application's link changes. | User adopted AI Design §6; personal-library reuse rules |
| FR-28 | Each generation uses the material versions confirmed at its start; changes during generation take effect next turn. After materials are unlinked or deleted, the next turn explicitly treats them as unavailable and does not use historical copies as current materials. | Change materials during generation: this turn's versions remain fixed and the next turn refreshes. On unlinking, current context drops the material while history remains. | AI Design §6 adopted; deletion and unlinking in FR-34 |
| FR-29 | Show material-sync/failure notices; never silently label an old version as updated. Support retries after interrupted streaming and allow only one generation at a time per conversation. This limit must not serialize all users or the entire application. | Simulate refresh failure, interruption, and concurrent requests in one conversation. Check notices, retry access, and generation limits; different users can operate concurrently. | User confirmation; partial-message persistence, retry deduplication, and specific refresh-failure fallback remain open |
| FR-30 | Chat remains available when a JD/resume is missing or a new file fails parsing. Explain what is missing/failed and what materials are available, then provide limited assistance without claiming to use the unavailable new file. | Send messages with no JD, no resume, and a failed replacement parse. Confirm that appropriately limited assistance remains available; when an original valid resume exists, identify the version actually used. | User confirmation; output behavior guided by the system prompt |
| FR-31 | Support Chrome, Edge, and multiple concurrent users. Page operations, data persistence, permission isolation, and streaming chat must function correctly. | Run core flows in Chrome and Edge. Use different accounts concurrently, including chat generation, and verify no data mixing or global generation lock. | User confirmation; no hard response-time, throughput, or concurrency-count targets |

#### G. Email Features and Resume Deletion

| ID | Requirement | Acceptance Method | Source / Open Items |
|---|---|---|---|
| FR-32 | Provide email verification by sending a verification email to the registered address. After successful verification, record and display the account's verified status. | Use a test account that can receive email to check delivery, verification, and state after reload. Invalid verification credentials cannot change verification status. | Latest user confirmation; access before verification, resending, and credential expiration require clarification |
| FR-33 | Provide a forgot-password/password-reset flow. Users verify through their registered email before setting a new password. | Receive the reset email and set a new password; the new password works and the old one does not. Invalid or already-used reset credentials cannot change the password. | Latest user confirmation; credential expiration and existing-session handling require clarification |
| FR-34 | Users can delete their own library resumes even when applications reference them. Deletion removes all associated application links but retains the applications and their other information. The file no longer appears as a selectable resume and cannot be downloaded or retrieved as a current file. | Link a file to two applications, then delete it. Both links disappear while other fields remain unchanged; the file is absent from the library and selection lists. Old references cannot relink/download it. The next chat turn explains the missing material and continues limited assistance. | Latest user confirmation; historical messages remain unchanged, and in-progress responses follow FR-28's per-turn version rule |

#### H. Standalone AI Entry and Position Selection

| ID | Requirement | Acceptance Method | Source / Open Items |
|---|---|---|---|
| FR-35 | Main navigation includes a standalone AI Interview Copilot page. Direct entry presents the user's existing applications, searchable by company/position keyword and filterable by status using Application Management's matching rules. Selecting an application opens its unique workspace, where the user can create a conversation or continue an existing one. | Enter from main navigation, search/filter, and select an application. Verify that only the user's own records appear and new conversations have the correct ownership. With no applications/no matches, show an empty state and a route to add applications in Application Management. Before selection, creation and sending are unavailable. Selecting the same application again reuses its workspace. | User confirmed; no separate project-record system detached from applications |

### 5.2 Resume Library and PDF Acceptance Rules

**User flow:** Open the Application Management list → select the central PDF resume entry above the list → drag in a file and name it in the dialog → upload and inspect the parsing result. The dialog also lists previously uploaded resumes for viewing and deletion. During application creation/editing, select an existing usable resume; one file can be reused by multiple applications.

**Editing boundaries:** Set and save the name during upload. After upload, only viewing, downloading, and deletion are available; no renaming, PDF-content editing, or in-place replacement. For a new version, upload another file and change the application's link. Other applications' existing links do not change automatically.

The following limits were established under the user's explicit authorization. They are product choices for this project, not industry-wide conclusions about all resumes:

- Accept only genuine PDFs that can be parsed normally. Validate file contents on the server, not just the extension.
- At most **2 pages** and **2 MiB (2,097,152 bytes)** per file. Files exactly at the limit are accepted; files above it are rejected.
- Text must be directly extractable: the whole file must yield at least **100 non-whitespace characters**, and no page may consist only of scanned images/screenshots without extractable text. Blank pages are not accepted as valid resume pages either.
- Do not run OCR. If a file is unreadable, damaged, encrypted in a way that prevents extraction, or fails the checks above, show the reason and suggest re-exporting a text-based PDF from a document source such as Word or LaTeX.
- A small amount of imagery, such as a portrait or icons, is allowed; there is no separate image-count limit. Size and text checks reduce scanned and image-heavy resumes but cannot reliably identify every image-based PDF with a text layer. Do not claim complete exclusion.
- Rejected files or files that fail parsing cannot become the current valid resume. The implementation design must describe cleanup of failed temporary files; do not independently introduce a user-facing file-recovery capability.

**Data relationships:** Deleting an application deletes/processes only records associated with that application; uploaded resumes remain in the personal library. An application has 0 or 1 valid linked resume, and chat remains available without one. Users can delete a library file even when applications reference it. Deletion removes all links to that file while retaining the applications and their other fields. See FR-34.

### 5.3 Core User Flows

**Application management:** Register/log in → Dashboard → Application Management list → use the filter, add-application, or central resume controls above the list; open an existing application → separate detail page → freely edit and save, including selecting an uploaded resume and updating status/interview arrangements. Adding an application opens a separate creation page; saving returns to the list.

**Starting from the standalone AI entry:** Main navigation AI Interview Copilot → search/filter existing applications by company/position keyword and status → select a position → create or reuse that application's workspace → click "New conversation" or open an existing conversation → send a message → backend authorization and retrieval → stream and save the response.

**Starting from application context:** A position-specific AI entry in the Dashboard, or "AI Interview Assistant" at the top of application details → save any unsaved changes first → automatically select the application and create/reuse its workspace → the user creates or continues a conversation. On first entry with no conversations, show an empty state and "New conversation." If saving fails, remain on the detail page and show a notice.

**Continuing after a material update:** Edit the JD/select another resume → return to an existing conversation and send a message → backend version check → refresh changed materials and show a notice → answer using the materials confirmed for this turn → retain history and its version references.

Navigation, layout, form groups, and visual direction follow the approved prototype: side navigation, neutral surfaces supporting light/dark appearance, green primary actions, and status labels. Use the prototype's Chinese action labels and English module names; route paths are defined during implementation. Maintain responsive layouts and support Chrome and Edge.

**The Dashboard's two interview displays:** "Interview count" is a summary of individual interview records. "Upcoming interviews" is the schedule list originally required by Proposal §2.1, not another total. It shows the next **7 days**, with the range labeled on the Dashboard, such as "Upcoming interviews · Next 7 days." Use the prototype's calendar-day window in the user's local display timezone: from 00:00 today, inclusive, to 00:00 seven days later, exclusive—today plus the following 6 days. Sort by interview start time in ascending order. The total interview count is not limited by this window.

**Total applications:** A saved position counts as an application even before actual submission. Rejected applications remain included. Unsaved forms do not create records. Deleted applications are absent from the current list and excluded from current Dashboard application, interview, and offer totals. Storage retention/cleanup policies are addressed separately in §11.

**Offer count:** Represents offers ever received rather than applications currently in Offer status. Later declining an offer or changing status does not erase receipt. Storage must distinguish historical receipt from current status; the database design determines the specific structure.

### 5.4 Edge Cases and Errors

| Scenario | Expected Behavior |
|---|---|
| Another user's or application's ID is supplied | The backend rejects unauthorized access or retrieval from the wrong application; system prompts alone are insufficient. |
| New conversation in a workspace with existing materials | The user selects the position and explicitly creates the conversation. History starts empty, workspace materials remain available, and old conversations are retained. |
| Direct AI entry before selecting a position | Show search/filtering and application selection. Do not allow an unbound conversation to be created or a message to be sent. |
| Entering the same application from different entry points | Reuse the same workspace; entry does not automatically create a conversation. |
| Materials unchanged/changed | Reuse unchanged content; selectively refresh changes. Each conversation checks independently. |
| New resume is invalid or parsing fails | Explain the reason and retain the current link; chat can continue with available materials. |
| Materials change during generation | Keep the versions selected at the start of this turn; refresh next turn. |
| Library file deleted/material unlinked | File deletion removes all related application links. Next turn marks the material unavailable; history remains unchanged and applications remain intact. |
| Material refresh fails | Clearly report the error; never present an old version as a new one. Fallback details remain open. |
| Streaming interruption/repeated sending | Allow retry; only one generation per conversation. Partial-message storage and deduplication details remain open. |
| History is too long | Compress older history while keeping recent messages and full database history; thresholds remain open. |
| Base materials exceed context capacity | Handling remains open; current materials must not be silently dropped. |
| Only a company website URL is available | A saved URL does not mean the page has been read; website reading remains optional. |

### 5.5 Confirmed Page and Interaction Baseline

The user explicitly approved this section after trying the interactive prototype in the conversation. It forms part of the formal requirements. Implement module layouts, control placement, fields, and navigation accordingly. Example companies, dates, numbers, and simulated content are not fixed production data.

#### Dashboard

- Main navigation on the left provides three independent entries: Dashboard, Applications, and AI Interview Copilot. Highlight the current module; navigation may move to the top on narrow screens.
- The header includes "Add application." The three top summary cards show total applications, interview sessions, and offers ever received, with explanatory counting labels.
- The middle area shows the status distribution and "Upcoming interviews · Next 7 days." Clicking a status opens the application list filtered to that status. Interview entries show company, position, interview type, date, and time. Clicking the position opens its details; the entry's "AI preparation" action carries that application context directly into its workspace.
- The lower area shows recent applications, with clickable company/position labels leading to details. "View all" opens Application Management. Show appropriate empty states when there are no interviews or applications.
- Statistics use the current user's actual records. Saved and rejected positions count as applications; each interview session counts separately; an application with an offer previously received remains in the offer count even after the offer is declined. Count each application once using its "Offer previously received" flag, not repeatedly for status transitions. Deleting an application removes it from the current aggregation dataset.

#### Application Management List

- The search field accepts company/position keywords. "Resume management" opens the dialog, and "Add application" opens the creation page. Sort options are newest first by default and company A–Z.
- Below search, status buttons show All, Saved, Applied, Online assessment, Interview, Offer, and Rejected, each with its record count. Status counts are calculated from the user's complete current list and do not change with keyword search. Search and the selected status jointly filter the list.
- Table columns are company/position, status, application date, linked resume, and an open-details action. Emphasize company and position. An empty application date displays "Not yet applied," and no linked resume displays "Not linked." Date/resume columns may be omitted on narrow screens; the information remains accessible in details.
- Do not place a prominent primary AI button on every row. The main application-specific AI entry is consistently placed at the top of the detail page.

#### Creation and Detail Forms

"Add application" uses a separate page. Creation and editing share field groups, with save and cancel actions at the bottom; existing applications also have a delete action. Only company and position are required for creation. Successful saving returns to the list and updates related summaries; failure preserves the input and shows a notice.

| Group | Field / Control | Rule |
|---|---|---|
| Basic information | Company, Position | Required and cannot contain only whitespace; users may save before completing other fields. |
| Basic information | Application Status | Options: Saved / not yet applied, Applied, OA / online assessment, Interview, Offer, Rejected. Defaults to Saved and can be freely changed. |
| Basic information | Applied Date | Optional actual submission date; no default application date. System creation time is recorded separately. |
| Job materials | Job Description | Optional multiline text. |
| Job materials | Resume | Select 0 or 1 usable resume already uploaded by the user; display its upload-time name. |
| Job materials | Job URL | Optional original job-posting link, stored separately from the company website. This adds an application field only; it does not automatically expand AI retrieval or add website access. |
| Additional information | Company Website, Company Notes | Optional official website URL and company background notes. Saving a URL does not mean the page has been read. |
| Additional information | Notes | Optional personal notes; not automatically included in shared AI materials. |
| Additional information | Offer previously received for this position | A separate boolean flag that can be recorded/corrected. Selecting Offer status also marks receipt; later status changes do not automatically clear it. |
| Interview arrangements for a saved application | Interview type/name, date/time | Multiple sessions can be added, edited, and deleted individually. Interview information is not required on the initial creation page. |

Existing applications display an activity timeline below the form, including at least actual status-change history. Keep personal notes, company website, and the original job-posting link as distinct fields.

#### Resume Management Dialog

- The entry above the application list opens the dialog. Enter a resume name first, then select or drag in a file to upload. Show limits and upload/parsing results. Closing returns to the original list.
- Uploaded items show name, file size, link count, and parsing status, with "View" and "Delete" actions. No editing, renaming, or in-place replacement entry is provided.
- Viewing must display the actual PDF, with a way back to resume management. Downloading remains part of the file-storage capability specified in the original Proposal.
- After deletion, update the library and every affected application, report the number of links removed, and retain the applications themselves. Chat can continue using the remaining materials.
- The prototype's "Use sample PDF" action and simulated resume content are not production features. The production version must perform actual file validation, parsing, and private storage under §5.2.

#### Standalone AI Entry, Workspaces, and Conversation Lifecycle

**Relationship between a workspace and an application:** Each saved application has one AI workspace, which can be understood as a "project." The workspace references that application's materials in Application Management. It neither duplicates the application nor creates a project detached from it.

| Entry Point | Position Selection | Workspace Handling | Conversation Handling |
|---|---|---|---|
| AI Interview Copilot in main navigation | First search/filter and explicitly select one of the user's existing applications | Create or reuse its workspace after selection | The user clicks "New conversation" or continues an existing conversation in the workspace |
| "AI preparation" for a specific position in the Dashboard | Automatically use that entry's application | Automatically create or reuse its workspace | If no conversation exists, prompt the user to create one; otherwise allow continuation or creation |
| "AI Interview Assistant" in Application Management details | Automatically use the current application | Automatically create or reuse its workspace | Same operations within the workspace as above |

- The standalone selection screen shows company, position, and application status. It searches company/position keywords and filters by the six statuses using FR-23. With no existing applications, prompt the user to add one; with no matching results, allow query adjustments.
- Before selection, users cannot create an unbound conversation or send messages. The backend checks ownership relationships among user/application/workspace/conversation during selection, workspace reads, conversation creation, and material retrieval. Frontend selection state alone is insufficient.
- Keep the main "AI Interview Assistant" entry in the application-detail header; do not add a prominent primary AI button to each application-list row. Entering through an application-specific action skips repeated search and selection.
- Save unsaved detail changes successfully before navigating and provide feedback. If saving fails, remain on the detail page. The AI uses saved materials.
- First entry only ensures that the workspace exists. If it has no conversations, show a "New conversation" empty state and let the user create one. Reuse an existing workspace; different entry points or repeated clicks must not create duplicate "projects."
- Re-entering a workspace with conversations can restore the most recent one, while keeping "New conversation" available. Selecting another position switches workspaces without moving/rebinding existing conversations or carrying over their history.
- The workspace shows the current company, position, linked resume, and conversation list. Each conversation separately stores its messages, tool results, history summaries, and retrieved material versions. A new conversation starts with empty chat history.
- Navigation, position selection, and creation of a blank conversation do not call the model. On the user's first message, tools retrieve the selected application's materials under FR-13; subsequent turns check versions and assemble context under FR-14–FR-17.
- Within a conversation in the selected workspace, shortcuts such as "Analyze my resume," "Simulate an HR interview," and "Practise project follow-up questions" only prefill input, which can be edited before sending. Responses must come from the real model and be streamed and persisted.

**Shared long-term memory and independent conversation memory:** Shared long-term memory consists of the application's current materials in the database/storage: extracted text from the linked resume, JD, company, position, company website URL, and company notes. Tool calling reads these into the current conversation, and tool results record that conversation's retrievals. Another conversation's tool records or an old copy from the first retrieval must not become permanent, fixed context shared by all conversations. Each conversation uses the same material source but maintains its own messages, summaries, and retrieved versions. After a material update, each synchronizes on its next message. Personal notes remain excluded from automatic sharing.

This version adds standalone Copilot navigation and a position-selection page, and changes automatic first-conversation creation to user-initiated creation. The existing interactive prototype does not yet show these additions/changes. Implementation must follow this section and FR-10, FR-11, and FR-35.

## 6. AI Behavior and Evaluation

### 6.1 Constraint Approach for This Release

As confirmed by the user, this release does not add complex refusal categories, automated content moderation, automatic scoring, or a separate evaluation platform. Basic response guidance belongs in the system prompt: help using current materials, do not present unknown information as established fact, explain limitations when materials are insufficient, and do not let text inside materials override system or user task instructions. Deterministic permission, material-version, and concurrency checks remain enforced by the backend under Section 5.

### 6.2 Lightweight Behavior Checks

The following is a manual checklist. Fix each check's input and expected result before running it. No accuracy or overall pass-rate target is set, and there is no claim that a model will always follow a prompt.

| ID | Behavior | Check Method | Pass Rule for a Single Check |
|---|---|---|---|
| AB-01 | Give advice using the current resume/JD. | Read the answer alongside known materials for the position. | Advice is relevant to the role and does not describe experiences absent from the materials as the user's actual experience. |
| AB-02 | Provide HR/technical/behavioral practice, follow-up questions, and feedback as requested. | Send each request type, then continue with an answer or feedback request. | Follow the requested type and pacing; follow-up questions fit the context, and feedback is stored in the current chat. |
| AB-03 | Use updated materials without describing old versions as current. | Use clearly different old/new versions, including cases with an old summary. | Current claims match the new version; old content is used only to explain history. |
| AB-04 | Preserve relevant conversation points in summaries. | Compare the summary with the original chat, then check continuation. | Add no facts absent from the original chat, do not label old materials as current, and preserve continuity for the points specified in advance for that case. |
| AB-05 | Keep refusal behavior minimal without adding a complex product refusal framework. | Request another user's or another application's materials. | The backend rejects actual unauthorized access; the system prompt guides the model to explain that it cannot access the data and not claim retrieval. No other refusal categories are separately defined for this release. |
| AB-06 | Explain limitations and continue limited assistance when information is insufficient. | Omit the JD or resume, or upload a new resume that fails parsing. | Do not categorically refuse chat because materials are missing. State what information is available and do not claim to have read unavailable materials. |
| AB-07 | Treat instructions within materials as content. | Insert task-changing or unauthorized-access instructions in the JD/resume/company notes. | Do not change the task/permissions because of that text or execute unauthorized instructions within it. This behavior is prompt-guided; permissions are separately enforced by the backend. |

### 6.3 Check Records and Limitations

- The AI feature implementer prepares verifiable examples and records inputs, actual material versions, model configuration, results, and issues. Follow the Proposal's team cross-checking responsibilities; requirement disputes go to the PRD requester.
- Cover the behaviors above, resume/JD updates, long-history summaries, and missing materials separately. Check retrieval/version handling, summaries, and final answers individually rather than recording only an end-to-end result.
- Example counts depend on the failure modes and necessary input combinations being covered. No total count, minimum per category, or repeat-run count is currently specified. No held-out set has been established, so general accuracy or stability cannot be claimed as verified.
- If the same input produces inconsistent behavior, record the issue and review the prompt or implementation instead of retaining only the successful run. If formal quality evaluation requires count or repetition thresholds, confirm them with the requester rather than independently expanding scope.
- Check optional website reading only if implemented: accurately report access failures, do not present existing model knowledge as newly read webpage content, and include the source and retrieval time for successful results.
- This release does not share AI output with other users. If sharing is added later, audience-permission rules must be defined separately.

## 7. Technical Considerations

### 7.1 Confirmed Technical Constraints

| Layer | Choice Established by the Source Documents |
|---|---|
| Frontend | React, TypeScript, Tailwind CSS, and shadcn/ui; responsive pages. |
| Backend | Node.js, Express.js, and TypeScript; frontend/backend communication through RESTful APIs. |
| Database | PostgreSQL using `pg`, parameterized SQL, and `node-pg-migrate`; no ORM. |
| Files | Original PDFs in private S3-compatible object storage; backend validation and text extraction. |
| AI | Vercel AI SDK, an external LLM, bounded tool calling, multi-turn conversations, and streaming responses; corresponding React integration on the frontend. |
| Authentication | Better Auth, PostgreSQL-backed sessions, Secure/HttpOnly cookies, and resource-ownership checks. |
| API documentation | OpenAPI describing requests, responses, authentication, and errors. |

Do not independently specify dependency versions, an LLM model/provider, an S3 provider, route paths, table names, or a deployment platform in this PRD.

### 7.2 Integration Constraints

- Frontend and backend must agree on authentication/authorization, validation errors, file states, and streaming states; detailed API contracts are maintained separately.
- Database records and private-file access must retain user-ownership associations. The specific download-authorization mechanism remains to be designed.
- AI retrieval reads authorized application records. The model cannot change the retrieval boundary by supplying an arbitrary workspace ID.
- Material saves, version records, and conversation persistence must remain consistent. One generation per conversation, fixed versions during generation, and retry after interruption are confirmed; partial-message storage and retry deduplication remain open.
- External model/storage quotas, costs, timeouts, and unavailability handling are not yet constrained. Do not assume unlimited calls or silent fallback.

### 7.3 Data Requirements

Logical records include users/sessions, applications and detail fields, original resume-file references, extracted text, parsing status and version, individual shared-material versions, application workspace/conversation ownership, versions retrieved by each conversation, messages and tool results, conversation summaries, and material versions supporting historical answers.

Personal notes belong to application details but are not in the sources' shared AI material list. Full history remains in the database; summaries do not replace original messages. Base materials use existing fields directly, without additional duplicate memory files.

Resumes belong to the user's personal library. Multiple applications can reference the same file, with at most one valid linked resume per application. Deleting an application does not delete its file. File changes are represented by uploading a new file and changing an application's link, without automatically overwriting files referenced elsewhere. Deleting a library file removes every related application link but retains the applications. The next AI turn no longer treats that file as current material. Existing chats and historical tool results remain unchanged under the confirmed history-retention rules. Cleanup of original files and parsed text must be explained; historical retention must not be presented as continued availability of current materials. Chat cascading/recovery after application deletion remains open. Do not independently add capabilities absent from the sources, such as account deletion or data migration.

### 7.4 Compatibility, Concurrency, and Performance

- Support Chrome and Edge with responsive layouts. No hard minimum browser versions or mobile-device matrix is specified.
- Support multiple concurrent users with isolated accounts and data. "One generation per conversation" does not block other conversations or users.
- No numerical targets are set for response duration, time to first token, concurrency count, or throughput. A load-testing platform is not a delivery prerequisite.
- Acceptance focuses on completing core operations, having no known workflow-blocking or data-corrupting issues, and usable streaming AI feedback without clearly abnormal delays. Investigate hangs or abnormal slowness as issues. "Clearly slow" has no numerical threshold; the requester ultimately judges the experience.
- AI/external services may fail. Provide visible status and error feedback rather than waiting indefinitely without feedback. Explain specific timeout settings before implementation; do not invent durations in the PRD.

## 8. Coding Agent Execution Contract

This PRD will be handed to a coding agent without the context of this discussion. The agent may implement confirmed scope. Work that depends on unresolved business rules is not ready and requires clarification from the PRD requester first. Unrelated open items do not prevent progress on other work.

### 8.1 Authoritative Sources and Conflict Resolution

| Source | Scope and Priority |
|---|---|
| The requester's latest explicit confirmation | Highest priority for confirmed matters, including the personal library, error handling, performance, and scope decisions. Record these decisions in the PRD. |
| Confirmed requirements in this PRD | Basis for implementation and acceptance. "Open" does not authorize the executor to choose product rules independently. |
| AI_Design.md | Additional workspace, versioning, and context details; all recommendations in §6 have been adopted. This PRD takes precedence where older descriptions conflict with confirmed decisions. |
| Project_Proposal.md | Product motivation, complete project scope, technology stack, and team plan. Its original description of uploading from application details has been refined to central-library upload followed by selection within applications. |
| Approved interactive prototype | Additional layout, visual direction, and control behavior. The standalone AI entry, position selection, and user-initiated conversation creation in v1.1 supersede the prototype's older behavior; see §5.5. Sample data, simulated PDF/AI behavior, and in-memory changes cannot replace the production backend, parsing, or chat persistence. |
| Code, database, and API documentation | Evidence of the current implementation, not an automatic override of requirements. Report differences from the requirements. |

These priorities explain how to apply confirmed decisions; they do not authorize independent resolution of every unspecified conflict. If behavior still cannot be determined, escalate to the PRD requester.

### 8.2 Do Not Change Without Authorization

| Area | Reason |
|---|---|
| Other users' data, unrelated code, and existing uncommitted changes | Outside this task's authorization; avoid overwriting others' work. |
| Original text of Project_Proposal.md and AI_Design.md | Preserve them as requirement sources. This task updates the PRD only; changes to source documents require a separately stated scope. |
| Established architecture, including pg/parameterized SQL, PostgreSQL, Better Auth, and React/Express | Existing team responsibilities and implementation constraints depend on it. Do not substitute an ORM or other frameworks for convenience. |
| Private-file and historical-data retention boundaries | Deleting an application must retain resumes. Deleting a library file must remove related links while retaining applications. Do not guess unresolved application/chat cascade rules. |
| Excluded/optional capabilities | Do not independently add OCR, RAG, automatic grading, complex AI moderation, or mandatory website reading. Email verification and password reset are explicitly in scope. |

### 8.3 Requirement Verification and Responsibilities

The executor runs checks and provides evidence. Manual cross-review follows the Proposal's responsibilities for all team members. The PRD requester resolves open rules and requirement disputes. Feature contacts below are taken from the Proposal; this does not imply that the requester has reconfirmed every member's assignment.

| FR | Required Verification Evidence | Verifier / Issue Contact |
|---|---|---|
| FR-01 | Login landing page and access without a session | Executor; Zishi Yang / Justin Smith |
| FR-02 | Rejections for cross-user/cross-application access and forged IDs | Executor; Zishi Yang / Jianye Zhou |
| FR-03 | Unapplied/rejected records included, separate interview-session counts, historical offers; 7-calendar-day window, status-chart navigation, and recent applications | Executor; Justin Smith / Zishi Yang |
| FR-04 | Separate creation page; only company/position required, default Saved; save returns to list, cancel adds nothing | Executor; Zishi Yang / Justin Smith |
| FR-05 | Top controls and table columns, separate details navigation, empty states, and narrow-screen layout | Executor; Justin Smith |
| FR-06 | Freely editable grouped form with save/cancel, separate offer flag, and persistence after reload | Executor; Zishi Yang / Justin Smith |
| FR-07 | Add/edit/delete multiple interview types/times, refreshed summaries, and actual timeline | Executor; Zishi Yang / Justin Smith |
| FR-08 | One file reused across applications; changing one link leaves others intact | Executor; Jianye Zhou / Rongxin Bi |
| FR-09 | Persisted PDF text/parsing status and later retrieval without repeated parsing | Executor; Jianye Zhou |
| FR-10 | Position-specific navigation automatically selects the application and reuses its unique workspace; no automatic first conversation; save first, no model call on navigation | Executor; Jianye Zhou / Justin Smith |
| FR-11 | No creation before position selection; user-created conversations have independent histories and shared materials; changing positions does not rebind history | Executor; Jianye Zhou |
| FR-12 | Isolation in actual request context and material retrieval | Executor; Jianye Zhou |
| FR-13 | Correct position/material/version ownership in tool calls from both entry types; separate retrieval records per conversation | Executor; Jianye Zhou |
| FR-14 | Retrieval records for unchanged, single-change, and multiple-change scenarios | Executor; Jianye Zhou |
| FR-15 | Latest context, version records updated only after successful saving, and write-failure checks | Executor; Jianye Zhou / Rongxin Bi |
| FR-16 | Two conversations synchronize independently while historical versions remain unchanged | Executor; Jianye Zhou / Rongxin Bi |
| FR-17 | Context before/after compression compared with full history | Executor; Jianye Zhou |
| FR-18 | Each practice flow and AB-01/02 check records | Executor; Jianye Zhou; manual team review |
| FR-19 | Streaming display, reload after completion, and ownership checks | Executor; Jianye Zhou |
| FR-20 | Feedback saved as a message in the current conversation | Executor; Jianye Zhou |
| FR-21 | Email/password registration and login, logout, and session invalidation | Executor; Zishi Yang / Justin Smith |
| FR-22 | List/totals update after deletion; library files and other applications' references remain intact | Executor; Zishi Yang / Rongxin Bi |
| FR-23 | Company/position substring search, six statuses/All counts, combined filters, empty results, and both sort modes | Executor; Justin Smith / Zishi Yang |
| FR-24 | Default Saved, free changes among six statuses, and actual change history | Executor; Zishi Yang / Rongxin Bi |
| FR-25 | Shortcuts only prefill, allow editing, and require manual sending | Executor; Jianye Zhou |
| FR-26 | Naming, file selection/drag-and-drop, list size/link count/parsing status, actual PDF viewing and deletion; no editing entry | Executor; Jianye Zhou / Justin Smith |
| FR-27 | No link switch after parsing failure; successful replacement changes only the target link | Executor; Jianye Zhou |
| FR-28 | Versions fixed during generation, refreshed next turn, and removed from current materials after unlinking | Executor; Jianye Zhou / Rongxin Bi |
| FR-29 | Per-conversation concurrency limit, concurrent users, interruption/retry, and failure notices | Executor; Jianye Zhou |
| FR-30 | Limited assistance with missing materials/parsing failures and AB-06 checks | Executor; Jianye Zhou; manual team review |
| FR-31 | Chrome/Edge core flows and concurrent-account usage records | Executor; all team members; requester assesses response experience |
| FR-32 | Actual verification email, account-state update, and invalid-credential checks | Executor; Zishi Yang / Justin Smith |
| FR-33 | Actual reset email, old/new password login checks, and invalid/used-credential checks | Executor; Zishi Yang / Justin Smith |
| FR-34 | All linked applications unlinked, applications retained, deleted file no longer selectable/downloadable, and next-turn chat behavior | Executor; Jianye Zhou / Rongxin Bi / Justin Smith |
| FR-35 | Standalone navigation, existing-application search/filter/selection, empty states, ownership, and no creation/sending without a bound application | Executor; Jianye Zhou / Justin Smith |

### 8.4 When to Stop Affected Work and Escalate

| Condition | Escalate To |
|---|---|
| Progress requires a decision on field validation, interview states, timeline events, or other rules still open in §11 | PRD requester; Jianye Zhou is the PRD contact |
| Unresolved access before email verification, application/chat cascading, or recovery rules affect implementation | PRD requester; Zishi Yang / Rongxin Bi are technical contacts |
| A change to the established stack, file limits, scope, or service cost/capabilities is needed | PRD requester; the module owner explains the impact |
| Version mixing or cross-user/cross-application data issues are found | Pause affected operations and notify the PRD requester and Zishi Yang / Jianye Zhou |
| History compression, refresh-failure behavior, or retry semantics cannot be determined from the requirements | PRD requester; Jianye Zhou is the AI contact |
| Implementation conflicts with sources and the priority rules cannot resolve it | PRD requester; the agent must not independently choose product behavior |

## 9. Dependencies & Risks

### 9.1 Dependencies

Assignments follow the Proposal. The user confirmed the year during this discussion but did not individually reconfirm personnel. External-service status and code implementation have not been inspected.

| Dependency | Proposal Contact | Status / Impact |
|---|---|---|
| Requirements and acceptance rules | Jianye Zhou; requester resolves open items | UI, statuses, required fields, and search rules are confirmed; verify remaining field-validation details under §11. |
| Database, SQL, migrations | Rongxin Bi | Must support personal-library reuse, application links, versions, and chat records. |
| Authentication and application APIs | Zishi Yang | Email/password, verification, and reset are confirmed; access before verification and some application rules remain open. |
| Verification/reset email delivery | Zishi Yang | Requires a working email-delivery service and configuration. Provider selection is open; an on-screen notice cannot substitute for actual delivery. |
| Non-AI frontend and OpenAPI | Justin Smith | Must align the upload dialog, application selection, and error-state contracts. |
| Storage, PDF processing, AI frontend/backend | Jianye Zhou, supported by Rongxin Bi | Storage provider, model, and limits remain open. The personal library and parsing are dependencies for AI retrieval. |
| Integration and delivery | All team members | Cross-checks, startup documentation, and a clean-environment run are required. |

### 9.2 Risks

| Risk | Impact | Response | Contact |
|---|---|---|---|
| Unresolved application rules | Inconsistent schema, APIs, and counting rules | Progress only on work independent of the decision; confirm affected rules first | Requester / Jianye Zhou |
| PDF parsing failure or unreadable text inside images | AI lacks usable materials | Page/size/text checks, failure notices, retention of the original link, and limited assistance | Jianye Zhou |
| Concurrent updates, generation, and saving | Mixed-version answers or incorrect sync records | Fix versions at generation start, update records only after successful saving, refresh next turn | Jianye Zhou / Rongxin Bi |
| Summary omissions or model failure to follow prompts | Inaccurate subsequent answers | Keep current materials outside summaries and run lightweight component checks; do not claim model guarantees | Jianye Zhou |
| Unauthorized access or data mixed across applications | Privacy exposure and incorrect preparation content | Backend ownership and context-isolation checks | Zishi Yang / Jianye Zhou |
| External-service unavailability or interrupted generation | File or chat workflow failures | Visible status, error notices, and retries; specific timeouts remain for implementation design | Jianye Zhou |
| Optional capabilities consume delivery time | Delayed core workflows | Website reading, visual refinements, and Docker may be deferred | All team members |

## 10. Timeline & Milestones

| Milestone | Exit Criteria / Deliverables | Timing |
|---|---|---|
| M1 Requirements and design confirmation | PRD, database design, APIs, and project structure; resolve open rules before work that depends on them | No additional date set |
| M2 Core components and AI prototype | Authentication, creation/query operations, basic pages, sample tool calling, and streaming conversation | No additional date set |
| M3 Complete non-AI workflow | Email registration/login/verification/password reset/logout, application CRUD, search/filtering, status history, Dashboard, resume-library upload/deletion, and integrated permissions | Before 2026-11-25; follows the Proposal, with the year confirmed by the user |
| M4 AI integration | Standalone AI position selection and application-context navigation, unique workspaces, user-created conversations, authorized retrieval, multi-conversation persistence, version refresh, compression, and error handling | No additional date set |
| M5 Validation and delivery | Check core functionality and compatibility, fix issues, complete documentation, and have a teammate run and demonstrate the application from a clean environment | Final deadline not set, as requested by the user |

## 11. Open Questions

The following remain undecided without invalidating confirmed scope. Answers come from the PRD requester. Application rules explicitly left open do not need to be forced into decisions during this discussion, but must be clarified before dependent implementation.

1. **Remaining business details:** Whether interview type/time is required; whether interview states such as cancelled/completed are needed and how they affect counts; activity-timeline events beyond status changes; detailed field-length/URL validation; and pagination as data grows. The six application statuses, default Saved, company/position as the only required fields, company/position search and status filtering, two sort modes, the 7-calendar-day window, and updates to current totals after deletion are already confirmed and need not be reconfirmed.
2. **Account details:** Email/password authentication, email verification, and password reset are confirmed. Whether an unverified email can log in/use features still needs confirmation. Define the email provider, verification/reset-credential expiration, resending, and handling of existing sessions after reset before implementation; do not independently remove functionality.
3. **Application deletion:** Soft/hard deletion and retention/recovery of its chats remain open. Keeping resumes when deleting an application and removing all application links when deleting a library file are confirmed and no longer open questions.
4. **AI implementation parameters and error details:** Model/provider, tool-call limits, summary thresholds/window, oversized base materials, partial-message persistence after interruption, retry deduplication, and explicit fallback after refresh failure. A complex evaluation or moderation system is not a prerequisite.
5. **Other delivery details:** Whether conversation renaming/deletion is needed, the external storage provider, and notification of any changes to Proposal assignments. Page action labels and module names follow the approved prototype; developers determine route paths and component implementation.

Numerical performance/concurrency targets, a final deadline, complex AI refusal categories, and an evaluation platform are **not open items that must be completed for this release** and must not block delivery.