# Edge Cases

These files capture manual QA and regression scenarios for the hidden Developer Lab and the AI chatbot flow.

Files:

- `ai-chatbot.edge-cases.json`: Startup, validation, upstream failure, search, and deployment edge cases for the chatbot request flow. The current UI calls the `ai-chatbot` function name, while the checked-in edge function folder is `supabase/supabase/functions/ai-chat`.
- `developer-lab.edge-cases.json`: Transport, preview, ingestion, prompt-profile, and evaluation edge cases for the Developer Lab at `/__ops/dev-lab`.

Notes:

- These files are fixtures only. They are not imported automatically.
- The Developer Lab cases are written to match the current `/api/dev-lab/*` route shapes and the existing dev edge function actions.
- The chatbot cases are written to match the payload shape used by `src/components/ChatBot.js`.
