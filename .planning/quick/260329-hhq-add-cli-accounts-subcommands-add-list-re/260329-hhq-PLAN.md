---
phase: quick
plan: 260329-hhq
type: execute
wave: 1
depends_on: []
files_modified:
  - src/cli/accounts.ts
  - src/config.ts
  - src/index.ts
autonomous: true
requirements: [CLI-ACCOUNTS]

must_haves:
  truths:
    - "Running `caldav-mcp accounts list` prints configured accounts in a table"
    - "Running `caldav-mcp accounts add` interactively prompts for CalDAV fields and saves account + keychain credentials"
    - "Running `caldav-mcp accounts remove <id>` removes account config and keychain entry"
    - "Running `caldav-mcp` with no args starts the MCP server as before"
  artifacts:
    - path: "src/cli/accounts.ts"
      provides: "CLI accounts subcommand handler"
      exports: ["handleAccountsCommand"]
    - path: "src/config.ts"
      provides: "removeAccount function added"
      exports: ["removeAccount"]
    - path: "src/index.ts"
      provides: "CLI routing before MCP server startup"
  key_links:
    - from: "src/index.ts"
      to: "src/cli/accounts.ts"
      via: "import handleAccountsCommand, call before server.run()"
      pattern: "handleAccountsCommand"
    - from: "src/cli/accounts.ts"
      to: "src/config.ts"
      via: "getAccounts, saveAccount, removeAccount"
      pattern: "import.*config"
    - from: "src/cli/accounts.ts"
      to: "src/security/keychain.ts"
      via: "saveCredentials, removeCredentials"
      pattern: "import.*keychain"
---

<objective>
Add CLI `accounts` subcommands (add/list/remove) to caldav-mcp, matching the mail_mcp pattern.

Purpose: Allow users to manage CalDAV accounts from the command line before starting the MCP server, consistent with the mail_mcp companion project.
Output: `caldav-mcp accounts add|list|remove` CLI commands that work identically to mail_mcp's pattern.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/config.ts
@src/security/keychain.ts
@src/index.ts

<interfaces>
<!-- Existing exports the new CLI module will consume -->

From src/config.ts:
```typescript
export const ACCOUNTS_PATH: string; // ~/.config/caldav-mcp/accounts.json
export type CalDAVAccount = { id: string; name: string; serverUrl: string; authType: 'basic' | 'oauth2'; username: string };
export async function getAccounts(): Promise<CalDAVAccount[]>;
export async function saveAccount(account: CalDAVAccount): Promise<void>; // upsert semantics
```

From src/security/keychain.ts:
```typescript
export async function saveCredentials(accountId: string, secret: string): Promise<void>;
export async function removeCredentials(accountId: string): Promise<void>;
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add removeAccount to config.ts and create CLI accounts handler</name>
  <files>src/config.ts, src/cli/accounts.ts</files>
  <action>
1. In `src/config.ts`, add a `removeAccount(id: string)` function that:
   - Reads accounts from disk (use same pattern as saveAccount -- read file, parse, modify, write)
   - Finds account by id; if not found, returns false
   - Splices it from the array and writes back to ACCOUNTS_PATH
   - Calls resetConfigCache() after writing
   - Returns true on success, false if id not found

2. Create `src/cli/accounts.ts` modeled on mail_mcp's `src/cli/accounts.ts` but adapted for CalDAV fields:

   `handleAccountsCommand(args: string[]): Promise<boolean>`:
   - If args[0] !== 'accounts', return false (caller starts MCP server)
   - Route args[1] to add/list/remove subcommands
   - On unknown/missing subcommand: print usage `caldav-mcp accounts <add|list|remove>` and process.exit(1)

   `listAccounts()`:
   - Call getAccounts() from config.ts
   - If empty, print "No accounts configured." and the config file path (ACCOUNTS_PATH)
   - Otherwise, print tabular output with columns: ID, Name, Server URL, Auth, Username
   - Use dynamic column widths (pad to max length of each field), same pattern as mail_mcp

   `removeAccount(id)`:
   - If no id arg, print usage and process.exit(1)
   - Call the new removeAccount(id) from config.ts
   - If returns false, print "Account '<id>' not found." and process.exit(1)
   - Try removeCredentials(id) from keychain.ts, catch and warn on failure
   - Print "Account '<id>' removed."

   `addAccount()`:
   - Use `createInterface` from `node:readline/promises` (same as mail_mcp)
   - Prompt for fields in this order:
     a. Account ID (required, unique -- check against existing IDs)
     b. Name (defaults to id if blank)
     c. Server URL (required, must be non-empty)
     d. Username (required, must be non-empty)
     e. Auth type (basic/oauth2) [basic] -- parse input, default to 'basic'
     f. If authType is 'basic': prompt for Password (stored in keychain, NOT config file)
     g. If authType is 'oauth2': print message that OAuth2 accounts should be registered via the register_oauth2_account MCP tool, and process.exit(1)
   - Call saveAccount() with the CalDAVAccount object
   - If basic auth with password, call saveCredentials(id, password)
   - Print confirmation message

   Imports:
   - `{ getAccounts, saveAccount, removeAccount, ACCOUNTS_PATH }` from '../config.js'
   - `{ saveCredentials, removeCredentials }` from '../security/keychain.js'
   - `{ createInterface }` from 'node:readline/promises'
   - CalDAVAccount type from '../config.js'
  </action>
  <verify>
    <automated>npx tsc --noEmit 2>&1 | head -20</automated>
  </verify>
  <done>src/cli/accounts.ts exports handleAccountsCommand; config.ts exports removeAccount; both compile cleanly</done>
</task>

<task type="auto">
  <name>Task 2: Wire CLI routing into index.ts entrypoint</name>
  <files>src/index.ts</files>
  <action>
Modify the `main()` function in `src/index.ts` to check for CLI args before starting the MCP server:

1. Import `handleAccountsCommand` from './cli/accounts.js'

2. At the top of `main()`, before creating CalDAVMCPServer:
   ```
   const args = process.argv.slice(2);
   if (args.length > 0) {
     const handled = await handleAccountsCommand(args);
     if (handled) return;
   }
   ```

3. The rest of main() (server creation and run) stays unchanged.

This matches mail_mcp's pattern: CLI commands return true and main() exits; no CLI args means start the MCP server.
  </action>
  <verify>
    <automated>npx tsc --noEmit && node dist/index.js accounts list 2>&1 || npx tsc && node dist/index.js accounts list 2>&1</automated>
  </verify>
  <done>`caldav-mcp accounts list` runs without error (shows "No accounts configured." or actual accounts); `caldav-mcp` with no args still starts MCP server on stdio</done>
</task>

</tasks>

<verification>
- `npx tsc --noEmit` compiles without errors
- `node dist/index.js accounts list` prints account table or "No accounts configured."
- `node dist/index.js accounts remove nonexistent` prints "Account 'nonexistent' not found."
- Running `node dist/index.js` with no args starts the MCP server (prints "CalDAV MCP server running on stdio" to stderr)
</verification>

<success_criteria>
- CLI `accounts add|list|remove` subcommands work identically in pattern to mail_mcp
- CalDAV-specific fields (serverUrl, authType basic/oauth2, username) replace IMAP fields
- Password stored in OS keychain via cross-keychain, never in accounts.json
- OAuth2 add redirects to MCP tool (not interactive CLI -- too many fields)
- No args = MCP server starts as before (no regression)
</success_criteria>

<output>
After completion, create `.planning/quick/260329-hhq-add-cli-accounts-subcommands-add-list-re/260329-hhq-SUMMARY.md`
</output>
