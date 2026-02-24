/**
 * contacts.test.ts — Full unit tests for addContact, removeContact, getContacts, resolveContact
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { addContact, removeContact, getContacts, resolveContact } from './contacts.js';
import { MoneyError } from './errors.js';

// ─── Isolation helpers ────────────────────────────────────────────────────────

let tmpDir: string;
const ORIGINAL_CONFIG_DIR = process.env.MONEY_CONFIG_DIR;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'money-contacts-test-'));
  process.env.MONEY_CONFIG_DIR = tmpDir;
});

afterEach(async () => {
  if (ORIGINAL_CONFIG_DIR === undefined) {
    delete process.env.MONEY_CONFIG_DIR;
  } else {
    process.env.MONEY_CONFIG_DIR = ORIGINAL_CONFIG_DIR;
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ─── addContact ───────────────────────────────────────────────────────────────

describe('addContact', () => {
  it('adds a contact with a chain-specific address', async () => {
    const result = await addContact({ name: 'Alice', chain: 'fast', address: 'set1abc' });
    assert.equal(result.name, 'Alice');
    assert.equal(result.chain, 'fast');
    assert.equal(result.address, 'set1abc');
    assert.ok(typeof result.note === 'string' && result.note.length > 0);
  });

  it('adds multiple chains to the same contact', async () => {
    await addContact({ name: 'Bob', chain: 'fast', address: 'set1bob' });
    await addContact({ name: 'Bob', chain: 'base', address: '0xbob' });

    const result = await getContacts({ name: 'bob' });
    assert.equal(result.contacts.length, 1);
    assert.equal(result.contacts[0].addresses['fast'], 'set1bob');
    assert.equal(result.contacts[0].addresses['base'], '0xbob');
  });

  it('is case-insensitive: adding "Alice" and "alice" updates the same contact', async () => {
    await addContact({ name: 'Alice', chain: 'fast', address: 'set1alice-v1' });
    await addContact({ name: 'alice', chain: 'fast', address: 'set1alice-v2' });

    const result = await getContacts({});
    assert.equal(result.contacts.length, 1);
    assert.equal(result.contacts[0].addresses['fast'], 'set1alice-v2');
  });

  it('rejects an empty name with INVALID_PARAMS', async () => {
    await assert.rejects(
      () => addContact({ name: '', chain: 'fast', address: 'set1abc' }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError, `expected MoneyError, got: ${String(err)}`);
        assert.equal((err as MoneyError).code, 'INVALID_PARAMS');
        return true;
      },
    );
  });

  it('rejects a name longer than 64 characters with INVALID_PARAMS', async () => {
    const longName = 'a'.repeat(65);
    await assert.rejects(
      () => addContact({ name: longName, chain: 'fast', address: 'set1abc' }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'INVALID_PARAMS');
        return true;
      },
    );
  });

  it('rejects a name with special characters with INVALID_PARAMS', async () => {
    await assert.rejects(
      () => addContact({ name: 'alice@example', chain: 'fast', address: 'set1abc' }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'INVALID_PARAMS');
        return true;
      },
    );
  });

  it('returns AddContactResult with a non-empty note', async () => {
    const result = await addContact({ name: 'Carol', chain: 'fast', address: 'set1carol' });
    assert.ok(typeof result.note === 'string');
    assert.ok(result.note.length > 0);
    assert.ok(result.note.includes('Carol') || result.note.toLowerCase().includes('contact'));
  });
});

// ─── removeContact ────────────────────────────────────────────────────────────

describe('removeContact', () => {
  it('removes a specific chain from a contact', async () => {
    await addContact({ name: 'Dave', chain: 'fast', address: 'set1dave' });
    await addContact({ name: 'Dave', chain: 'base', address: '0xdave' });

    const result = await removeContact({ name: 'Dave', chain: 'fast' });
    assert.equal(result.name, 'Dave');
    assert.equal(result.chain, 'fast');
    assert.ok(typeof result.note === 'string' && result.note.length > 0);

    // base chain should still exist
    const contacts = await getContacts({ name: 'dave' });
    assert.equal(contacts.contacts.length, 1);
    assert.equal(contacts.contacts[0].addresses['base'], '0xdave');
    assert.equal(contacts.contacts[0].addresses['fast'], undefined);
  });

  it('removes the entire contact when no chain is specified', async () => {
    await addContact({ name: 'Eve', chain: 'fast', address: 'set1eve' });

    const result = await removeContact({ name: 'Eve' });
    assert.equal(result.name, 'Eve');
    assert.equal(result.chain, undefined);
    assert.ok(typeof result.note === 'string' && result.note.length > 0);

    const contacts = await getContacts({});
    assert.equal(contacts.contacts.length, 0);
  });

  it('throws CONTACT_NOT_FOUND for an unknown contact', async () => {
    await assert.rejects(
      () => removeContact({ name: 'NonExistent' }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError, `expected MoneyError, got: ${String(err)}`);
        assert.equal((err as MoneyError).code, 'CONTACT_NOT_FOUND');
        return true;
      },
    );
  });

  it('removes entire contact when last chain is deleted', async () => {
    await addContact({ name: 'Frank', chain: 'fast', address: 'set1frank' });
    await removeContact({ name: 'Frank', chain: 'fast' });

    const contacts = await getContacts({});
    assert.equal(contacts.contacts.length, 0);
  });

  it('returns RemoveContactResult with a non-empty note', async () => {
    await addContact({ name: 'Grace', chain: 'fast', address: 'set1grace' });
    const result = await removeContact({ name: 'Grace' });
    assert.ok(typeof result.note === 'string');
    assert.ok(result.note.length > 0);
  });
});

// ─── getContacts ─────────────────────────────────────────────────────────────

describe('getContacts', () => {
  it('lists all contacts', async () => {
    await addContact({ name: 'Hal', chain: 'fast', address: 'set1hal' });
    await addContact({ name: 'Iris', chain: 'base', address: '0xiris' });

    const result = await getContacts({});
    assert.ok(Array.isArray(result.contacts));
    assert.equal(result.contacts.length, 2);
    const names = result.contacts.map(c => c.name);
    assert.ok(names.includes('hal'));
    assert.ok(names.includes('iris'));
  });

  it('looks up a single contact by name (case-insensitive)', async () => {
    await addContact({ name: 'Jack', chain: 'fast', address: 'set1jack' });

    const result = await getContacts({ name: 'JACK' });
    assert.equal(result.contacts.length, 1);
    assert.equal(result.contacts[0].addresses['fast'], 'set1jack');
    assert.ok(typeof result.note === 'string' && result.note.length > 0);
  });

  it('returns empty array when no contacts exist', async () => {
    const result = await getContacts({});
    assert.ok(Array.isArray(result.contacts));
    assert.equal(result.contacts.length, 0);
    assert.ok(typeof result.note === 'string');
  });

  it('returns empty contacts array for unknown name lookup', async () => {
    await addContact({ name: 'Known', chain: 'fast', address: 'set1known' });

    const result = await getContacts({ name: 'Unknown' });
    assert.equal(result.contacts.length, 0);
    assert.ok(typeof result.note === 'string' && result.note.length > 0);
  });

  it('returns ContactsResult with a note field', async () => {
    const result = await getContacts({});
    assert.ok('contacts' in result);
    assert.ok('note' in result);
    assert.ok(typeof result.note === 'string');
  });
});

// ─── resolveContact ───────────────────────────────────────────────────────────

describe('resolveContact', () => {
  it('resolves name + chain to the stored address', async () => {
    await addContact({ name: 'Laura', chain: 'fast', address: 'set1laura' });

    const address = await resolveContact('Laura', 'fast');
    assert.equal(address, 'set1laura');
  });

  it('returns null for an unknown name', async () => {
    const address = await resolveContact('NoSuchPerson', 'fast');
    assert.equal(address, null);
  });

  it('returns null for a known name but wrong chain', async () => {
    await addContact({ name: 'Mike', chain: 'fast', address: 'set1mike' });

    const address = await resolveContact('Mike', 'base');
    assert.equal(address, null);
  });

  it('is case-insensitive for name lookup', async () => {
    await addContact({ name: 'Nancy', chain: 'fast', address: 'set1nancy' });

    const lower = await resolveContact('nancy', 'fast');
    const upper = await resolveContact('NANCY', 'fast');
    const mixed = await resolveContact('NaNcY', 'fast');

    assert.equal(lower, 'set1nancy');
    assert.equal(upper, 'set1nancy');
    assert.equal(mixed, 'set1nancy');
  });

  it('returns null when contacts file is empty', async () => {
    const address = await resolveContact('anyone', 'fast');
    assert.equal(address, null);
  });
});
