# JobFlow AI: AI Workspace and Conversation Design

This document summarizes the confirmed design. The final section contains additional suggestions.

## 1. One Workspace per Application, with Multiple Independent Conversations

Each job application has an AI workspace, similar to a separate project. Users enter it from the application details page and can create or continue multiple conversations, such as "Resume Improvements," "HR Mock Interview," or "Technical Interview Practice."

| Level | Stored Content | Sharing Rules |
|---|---|---|
| Application workspace | Resume, job description (JD), company, position, company website URL, and company notes | Accessible only to conversations within that workspace |
| Independent conversation | User messages, AI responses, tool results, and mock interview feedback | Not automatically included in other conversations |

**A new conversation starts with an empty chat history but can still access the workspace materials without requiring another upload. Existing conversations are retained.** Data from different applications is isolated, and conversations within the same application do not automatically read one another's chat history.

Materials are stored in PostgreSQL and cloud storage. Their database records provide the shared foundational long-term memory described in Section 3.2. Function calling retrieves these materials, and tool results are saved to the current conversation as a record of what was read. Here, "shared memory" means a shared source of materials, rather than a single chat history shared by all conversations.

## 2. What Users Can Do

- **Resume advice:** Analyze the resume against the current position and JD and suggest improvements.
- **Interview practice:** Practise questions and follow-up questions about experience, skills, and job requirements.
- **Mock interviews:** Request an HR, technical, or behavioral interview through chat, with follow-up questions, summaries, or review suggestions available on request.
- **Company information lookup (optional future extension):** If implemented as time permits, read the company website when needed and cite the source.

The workspace displays the current company, position, linked resume, conversation list, "New Conversation" control, and chat area. Users can continue the same conversation or start another when the context becomes too long or they switch practice topics.

These activities all take place through free-form chat, with behavior guided mainly by prompt design. Shortcuts simply prefill instructions such as "Analyze my resume for the current position" or "Simulate an HR interview and ask one question at a time." Users can edit these instructions before sending them or enter their own requests. Feedback and summaries are saved as ordinary AI responses in the current chat. There is no separate mock interview start/end flow, report page, or feedback table. Material retrieval, update checks, permissions, and conversation isolation are handled by the backend.

## 3. Material Updates and Context Management

### 3.1 Material Updates

**Retrieve materials initially, reuse them while unchanged, and retrieve only the materials that change. Starting a new conversation is not required.**

1. When a conversation first starts, retrieve the application materials through tools, save the results to the conversation, and record each material's version.
2. Whenever the user sends a message, the backend compares the workspace's current versions with those already retrieved for the conversation. This check is performed programmatically and does not depend on the AI noticing changes.
3. If the versions match, reuse the previously retrieved material content when assembling the current request's context. If they differ, the backend retrieves the changed materials and uses their new versions in the base-material context before the AI responds.
4. Explicitly tell the AI which materials have changed and that the old content is only for understanding the conversation history. Once the new content has been saved successfully, update the conversation's retrieved-version records.

| What the User Changes | What Is Added When the Conversation Continues |
|---|---|
| Resume only | New resume content |
| JD only | New JD |
| Both resume and JD | Both updated materials |
| Nothing | Reuse the same material content; no repeated tool retrieval |

For example, a conversation has already retrieved resume V1. After the user uploads V2 and continues chatting, the backend adds V2 with a note: "The current resume has been updated to V2. Use V2 for subsequent analysis." Another existing conversation independently checks for and applies the update when it next receives a message.

Historical messages and feedback remain unchanged, with a record of the material versions they were based on. Timestamps show chronological order, while version identifiers determine whether materials have changed. The resume version used must not be inferred solely from message timestamps.

### 3.2 Sliding Window, Context Compression, and Long-Term Memory

After a PDF is uploaded, the backend parses it and saves the extracted resume text in a PostgreSQL `TEXT` field, together with its parsing status and version. The original PDF remains in cloud storage. Once parsing succeeds, conversations retrieve the saved text without downloading or parsing the PDF again.

The JD, company, position, website URL, and company notes remain in their corresponding database fields. These records and the linked resume text form the shared foundational long-term memory for all conversations within the same application. No `.md` file or separate duplicate memory field is required. The backend saves and updates materials through upload and editing operations; tool calling reads them for conversations.

When assembling the context for each answer, the backend includes the current base materials, the conversation's compressed history, recent messages, and the current user message. The base materials are kept outside the sliding window and history compression. Reusing unchanged materials under Section 3.1 means reusing their content, not omitting them from later requests or relying on the initial tool result remaining in chat history.

Only conversation history uses the sliding window and compression: recent messages are retained, and older content is summarized. Full history remains in the database. Each conversation has its own history and summaries. Summaries and historical tool results must not present outdated materials as current; the base materials follow the version checks and selective updates in Section 3.1.

## 4. Web Search and Company Website Reading (Optional Future Extensions)

All agent web search and website-reading capabilities are optional future extensions, subject to available time. Their completion is not guaranteed. If company website reading is implemented, the intended behavior is as follows.

The agent calls the website-reading tool only when the user explicitly requests it or asks a company-related question requiring information from the website. Ordinary resume discussions and interview practice do not automatically trigger website visits.

A website URL and its page content are separate: saving a link does not mean the page has been read. Retrieved content is saved in the current conversation with its source URL and retrieval time. If the website cannot be accessed, the agent clearly states this and does not present existing model knowledge as newly retrieved information. When up-to-date information is needed, the page is retrieved again; checking whether the URL has changed is not sufficient.

Whether the agent may follow links to other pages on the company website, and the maximum number of pages it may read per request, remain to be determined.

## 5. What the Backend Needs to Record

| Record | Purpose |
|---|---|
| Current workspace materials and their individual versions (shared long-term memory) | Store parsed resume text and parsing status, JD, and other application fields as the shared source of current materials |
| The workspace each conversation belongs to | Ensure each conversation accesses only the corresponding application's data |
| Material versions already retrieved for each conversation | For example, resume V2 and JD V1, used to determine whether a refresh is needed |
| Compressed conversation summaries | Preserve relevant older conversation context alongside recent messages without replacing the stored full history or current application materials |
| Messages and tool results | Save questions, answers, feedback, summaries, and the versions of the content actually retrieved, so users can revisit discussions and their supporting materials |

Every request checks ownership relationships between the user, application workspace, and conversation. The agent cannot access another application's data by supplying a different workspace ID. Responses are streamed to the interface and saved to the corresponding conversation once complete.

## 6. Additional Suggestions: Avoiding Common Problems

- **New resume parsing fails:** Switch the current version only after parsing succeeds. If parsing fails, notify the user rather than implying that the new file has been used.
- **Materials change during generation:** Continue the current response using the versions confirmed at its start. Refresh on the next message to avoid mixing versions within one response.
- **Materials are deleted or unlinked:** Treat this as an update and tell the AI that the material is no longer available, so it is not treated as a current source.
- **Update notifications and failure handling:** Show a message such as "Latest resume synced." Clearly report refresh failures rather than silently presenting old materials as current. Allow retries after interrupted streaming, and initially limit each conversation to one generation at a time.
