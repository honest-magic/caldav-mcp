import { createInterface } from 'node:readline/promises';
import {
  getAccounts,
  saveAccount,
  removeAccount as removeAccountFromConfig,
  ACCOUNTS_PATH,
} from '../config.js';
import type { CalDAVAccount } from '../config.js';
import { saveCredentials, removeCredentials } from '../security/keychain.js';

/**
 * Handle the `accounts` CLI subcommand.
 * Returns true if the command was handled (caller should exit),
 * false if args don't match (caller starts MCP server).
 */
export async function handleAccountsCommand(args: string[]): Promise<boolean> {
  if (args[0] !== 'accounts') return false;

  const subcommand = args[1];

  switch (subcommand) {
    case 'list':
      await listAccounts();
      break;
    case 'add':
      await addAccount();
      break;
    case 'remove':
      await removeAccountCmd(args[2]);
      break;
    default:
      console.error('Usage: caldav-mcp accounts <add|list|remove>');
      process.exit(1);
  }

  return true;
}

async function listAccounts(): Promise<void> {
  const accounts = await getAccounts();
  if (accounts.length === 0) {
    console.log('No accounts configured.');
    console.log(`Config file: ${ACCOUNTS_PATH}`);
    return;
  }

  // Calculate dynamic column widths
  const headers = { id: 'ID', name: 'Name', serverUrl: 'Server URL', authType: 'Auth', username: 'Username' };
  const widths = {
    id: Math.max(headers.id.length, ...accounts.map((a) => a.id.length)),
    name: Math.max(headers.name.length, ...accounts.map((a) => a.name.length)),
    serverUrl: Math.max(headers.serverUrl.length, ...accounts.map((a) => a.serverUrl.length)),
    authType: Math.max(headers.authType.length, ...accounts.map((a) => a.authType.length)),
    username: Math.max(headers.username.length, ...accounts.map((a) => a.username.length)),
  };

  const pad = (s: string, w: number) => s.padEnd(w);
  const row = (a: { id: string; name: string; serverUrl: string; authType: string; username: string }) =>
    `  ${pad(a.id, widths.id)}  ${pad(a.name, widths.name)}  ${pad(a.serverUrl, widths.serverUrl)}  ${pad(a.authType, widths.authType)}  ${pad(a.username, widths.username)}`;

  console.log(row(headers));
  console.log(`  ${'─'.repeat(widths.id)}  ${'─'.repeat(widths.name)}  ${'─'.repeat(widths.serverUrl)}  ${'─'.repeat(widths.authType)}  ${'─'.repeat(widths.username)}`);
  for (const account of accounts) {
    console.log(row(account));
  }
}

async function removeAccountCmd(id: string | undefined): Promise<void> {
  if (!id) {
    console.error('Usage: caldav-mcp accounts remove <account-id>');
    process.exit(1);
  }

  const removed = await removeAccountFromConfig(id);
  if (!removed) {
    console.error(`Account '${id}' not found.`);
    process.exit(1);
  }

  try {
    await removeCredentials(id);
  } catch {
    console.warn(`Warning: could not remove keychain entry for '${id}'.`);
  }

  console.log(`Account '${id}' removed.`);
}

async function addAccount(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const existingAccounts = await getAccounts();
    const existingIds = new Set(existingAccounts.map((a) => a.id));

    // Account ID
    let id = '';
    while (!id) {
      id = (await rl.question('Account ID: ')).trim();
      if (!id) {
        console.error('Account ID is required.');
        continue;
      }
      if (existingIds.has(id)) {
        console.error(`Account '${id}' already exists. Choose a different ID.`);
        id = '';
      }
    }

    // Name
    const nameInput = (await rl.question(`Name [${id}]: `)).trim();
    const name = nameInput || id;

    // Server URL
    let serverUrl = '';
    while (!serverUrl) {
      serverUrl = (await rl.question('Server URL: ')).trim();
      if (!serverUrl) {
        console.error('Server URL is required.');
      }
    }

    // Username
    let username = '';
    while (!username) {
      username = (await rl.question('Username: ')).trim();
      if (!username) {
        console.error('Username is required.');
      }
    }

    // Auth type
    const authInput = (await rl.question('Auth type (basic/oauth2) [basic]: ')).trim().toLowerCase();
    const authType: 'basic' | 'oauth2' = authInput === 'oauth2' ? 'oauth2' : 'basic';

    if (authType === 'oauth2') {
      console.log(
        'OAuth2 accounts should be registered via the register_oauth2_account MCP tool, which handles token storage.',
      );
      process.exit(1);
    }

    // Password for basic auth
    let password = '';
    while (!password) {
      password = (await rl.question('Password: ')).trim();
      if (!password) {
        console.error('Password is required for basic auth.');
      }
    }

    const account: CalDAVAccount = { id, name, serverUrl, authType, username };
    await saveAccount(account);
    await saveCredentials(id, password);

    console.log(`Account '${id}' added.`);
  } finally {
    rl.close();
  }
}
