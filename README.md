# caldav-mcp

MCP server for AI-powered calendar access via CalDAV. Works with Claude Desktop and other MCP clients.

## Features

- List calendars and events across multiple CalDAV accounts
- Create, update, and delete calendar events (with confirmation)
- Check scheduling conflicts (expands recurring events)
- Suggest available time slots with working hours filter
- Parse `.ics` calendar invite files
- OS keychain credential storage (no plaintext secrets)

## Install

### Homebrew (macOS)

```bash
brew tap honest-magic/tap
brew install caldav-mcp
```

### npm

```bash
npm install -g @honest-magic/caldav-mcp
```

### npx (no install)

```bash
npx @honest-magic/caldav-mcp accounts add
```

## Setup

### 1. Add a CalDAV account

```bash
caldav-mcp accounts add
```

Interactive prompts for account ID, server URL, username, and password. Password is stored in your OS keychain. Connection is tested automatically.

**Common server URLs:**
- iCloud: `https://caldav.icloud.com` (use an [app-specific password](https://support.apple.com/en-us/102654))
- Google: `https://apidata.googleusercontent.com/caldav/v2`
- Fastmail: `https://caldav.fastmail.com`
- Nextcloud: `https://your-server.com/remote.php/dav`

### 2. Register with Claude Desktop

```bash
caldav-mcp --install-claude
```

Restart Claude Desktop after running this.

### 3. Verify

```bash
caldav-mcp --validate-accounts
```

## CLI

```
caldav-mcp [options] [command]

Commands:
  accounts add        Add a new CalDAV account (interactive)
  accounts list       List configured accounts
  accounts remove ID  Remove an account

Options:
  --validate-accounts Probe CalDAV connections and exit
  --install-claude    Write caldav-mcp to Claude Desktop config and exit
  --version           Show version number
  -h, --help          Show this help message
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `list_calendars` | List all calendars across accounts |
| `list_events` | List events in a date range (expands recurring) |
| `read_event` | Read full event details |
| `create_event` | Create a new event (requires confirmation) |
| `update_event` | Update an existing event (requires confirmation + etag) |
| `delete_event` | Delete an event (requires confirmation + etag) |
| `check_conflicts` | Check if a time range conflicts with existing events |
| `suggest_slots` | Find available time slots with optional working hours |
| `parse_ics` | Parse raw iCalendar data |
| `register_oauth2_account` | Register a Google/OAuth2 calendar account |

## Requirements

- Node.js >= 18
- A CalDAV-compatible calendar server

## License

MIT
