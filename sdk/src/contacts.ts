/**
 * contacts.ts — Contact address book for money SDK
 *
 * Named contacts stored in ~/.money/contacts.json.
 * Format: { "<name_lowercased>": { "<chain>": "<address>", ... } }
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfigDir } from './config.js';
import { MoneyError } from './errors.js';
import type {
  AddContactParams,
  AddContactResult,
  ContactEntry,
  ContactsParams,
  ContactsResult,
  RemoveContactParams,
  RemoveContactResult,
} from './types.js';

export function getContactsPath(): string {
  return path.join(getConfigDir(), 'contacts.json');
}

export async function loadContacts(): Promise<Record<string, Record<string, string>>> {
  try {
    const raw = await fs.readFile(getContactsPath(), 'utf-8');
    return JSON.parse(raw) as Record<string, Record<string, string>>;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

export async function saveContacts(data: Record<string, Record<string, string>>): Promise<void> {
  const contactsPath = getContactsPath();
  await fs.mkdir(path.dirname(contactsPath), { recursive: true, mode: 0o700 });
  const tmpPath = `${contactsPath}.tmp.${process.pid}`;
  try {
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
    await fs.rename(tmpPath, contactsPath);
  } catch (err) {
    try { await fs.unlink(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

export function validateContactName(name: string): void {
  if (!name || name.length === 0) {
    throw new MoneyError('INVALID_PARAMS', 'Contact name must not be empty.');
  }
  if (name.length > 64) {
    throw new MoneyError('INVALID_PARAMS', `Contact name must be 64 characters or fewer (got ${name.length}).`);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new MoneyError(
      'INVALID_PARAMS',
      `Contact name "${name}" contains invalid characters. Only a-z, A-Z, 0-9, hyphens, and underscores are allowed.`,
    );
  }
}

export async function addContact(params: AddContactParams): Promise<AddContactResult> {
  const { name, chain, address } = params;
  validateContactName(name);
  const key = name.toLowerCase();
  const all = await loadContacts();
  all[key] = { ...(all[key] ?? {}), [chain]: address };
  await saveContacts(all);
  return {
    name,
    chain,
    address,
    note: `Contact "${name}" saved with ${chain} address ${address}.`,
  };
}

export async function removeContact(params: RemoveContactParams): Promise<RemoveContactResult> {
  const { name, chain } = params;
  const key = name.toLowerCase();
  const all = await loadContacts();

  if (!all[key]) {
    throw new MoneyError('CONTACT_NOT_FOUND', `Contact "${name}" not found.`);
  }

  if (chain) {
    delete all[key][chain];
    // If no addresses remain, remove the contact entirely
    if (Object.keys(all[key]).length === 0) {
      delete all[key];
    }
    await saveContacts(all);
    return { name, chain, note: `Removed ${chain} address from contact "${name}".` };
  } else {
    delete all[key];
    await saveContacts(all);
    return { name, note: `Contact "${name}" removed.` };
  }
}

export async function getContacts(params: ContactsParams): Promise<ContactsResult> {
  const { name } = params;
  const all = await loadContacts();

  if (name) {
    const key = name.toLowerCase();
    const entry = all[key];
    if (!entry) {
      return { contacts: [], note: `No contact found for "${name}".` };
    }
    const contacts: ContactEntry[] = [{ name: key, addresses: entry }];
    return { contacts, note: `Found contact "${name}".` };
  }

  const contacts: ContactEntry[] = Object.entries(all).map(([n, addresses]) => ({
    name: n,
    addresses,
  }));
  return { contacts, note: `${contacts.length} contact(s) found.` };
}

export async function resolveContact(name: string, chain: string): Promise<string | null> {
  const key = name.toLowerCase();
  const all = await loadContacts();
  return all[key]?.[chain] ?? null;
}
