# NovaSprint

NovaSprint is a local sprint planner built with LangGraph.js. Planning agents use the configured Nebius Token Factory model by default (or local Ollama when selected) and read live Jira project issues through one shared workspace connection. There is no sample or rule-based plan path.

## Requirements

- Node.js 20 or later
- A Nebius Token Factory API key, or Ollama installed and running locally
- Jira Cloud site and an API token with permission to read the chosen board and create, assign, and link issues in the target project

## Start on Windows

Open PowerShell in this folder.

1. Install JavaScript dependencies:

   ```powershell
   npm install
   ```

2. The local `.env` file contains Jira and model provider settings. Set `NEBIUS_API_KEY` to a Token Factory API key from Nebius and keep `MODEL_PROVIDER=nebius`. If using local Ollama instead, set `MODEL_PROVIDER=ollama`, start `ollama serve`, and install `qwen3:8b`.

3. The local `.env` file is prefilled with your Jira site. Add or update the Atlassian account email and API token there:

   ```powershell
   notepad .env
   ```

   Set `JIRA_BASE_URL` to your Jira Cloud site, and fill `JIRA_EMAIL` and `JIRA_API_TOKEN`. Keep `.env` private; it is ignored by Git. Restart NovaSprint after changing credentials.

4. Start NovaSprint:

   ```powershell
   npm start
   ```

5. Open [http://127.0.0.1:4176](http://127.0.0.1:4176).

## Workspace context

- NovaSprint uses `zai-org/GLM-5.3-Flash` through Nebius Token Factory by default. Its API key stays on the local server and is never sent to the browser.
- The Jira site and project `KAN` are configured in `.env` and the local workspace settings. The shared Jira connection reads open project issues for all five profiles.
- Replace the starter names and skills under **Team & skills** with your actual roster. Per-person Jira account IDs are optional for planning; add one when Jira issues should be assigned to that individual. Without a mapping, NovaSprint can recommend an owner but will leave the issue unassigned in Jira.
## Run an end-to-end planning check

1. Use a Jira test project/board while trying the publisher for the first time.
2. Click **Plan a sprint**, enter a one-line Sprint Goal and dates, then submit. A task list is optional; the Task Decomposer derives tasks from the goal and project context.
3. Watch the live LangGraph agent updates. The run uses the configured model provider and selected Jira board; a connection/model error stops the run.
4. Review the generated scope, dependencies, estimates, assignments, acceptance criteria, and agent findings.
5. Jira Publisher creates the planned Jira issues automatically, sets them to **To Do**, assigns mapped team members, links dependencies, and adds issues to the selected sprint when one is configured.
6. Check the publication result in NovaSprint Plan history. Select **Track** to run Monitor Agent against Jira and refresh the progress dashboard.

Planning automatically writes real Jira issues. Use a test project if you do not want to change a production backlog.

## Implementation guide

See [docs/NovaSprint_Implementation_Guide.pdf](docs/NovaSprint_Implementation_Guide.pdf) for the product primer, the research paper's Modular Agentic Planner (MAP), NovaSprint's implementation mapping, agent responsibilities, and technical architecture. The Word file is title-sanitized for import into Google Docs.

## Local checks and troubleshooting

Run the syntax check after code changes:

```powershell
npm run check
```

If planning is unavailable, confirm:

- Nebius Token Factory key, API base URL, and selected model are valid in `.env`, or Ollama is running with `qwen3:8b` installed if using local mode.
- The Jira URL, email, and token are correct in `.env`; restart NovaSprint after changing the file.
- The Jira site, project, and board are available to the shared account configured in `.env`.
- Each teammate has a Jira account ID if Jira issues should be assigned directly to that person.

The app listens on loopback only. Workspace settings, profiles, plans, and the audit trail live in `data/workspace.json`, created on first start and ignored by Git. Jira secrets remain in `.env` and are not sent to the browser.
