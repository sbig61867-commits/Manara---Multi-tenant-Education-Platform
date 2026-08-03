import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { discoverMigrations } from '../../src/migrations/runner.js';

async function withTempDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'manara-migrations-'));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('discoverMigrations orders files numerically and ignores non-sql files', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, '0010_later.sql'), '');
    await writeFile(join(dir, '0002_second.sql'), '');
    await writeFile(join(dir, '0001_first.sql'), '');
    await writeFile(join(dir, 'README.md'), '');
    const migrations = await discoverMigrations(dir);
    assert.deepEqual(
      migrations.map((m) => m.version),
      ['0001', '0002', '0010'],
    );
    assert.deepEqual(
      migrations.map((m) => m.name),
      ['first', 'second', 'later'],
    );
    assert.deepEqual(
      migrations.map((m) => m.filename),
      ['0001_first.sql', '0002_second.sql', '0010_later.sql'],
    );
  });
});

test('discoverMigrations rejects duplicate versions', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, '0001_one.sql'), '');
    await writeFile(join(dir, '01_two.sql'), '');
    await assert.rejects(discoverMigrations(dir), /Duplicate migration version/);
  });
});

test('discoverMigrations rejects files that do not match the naming convention', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'first.sql'), '');
    await assert.rejects(discoverMigrations(dir), /Invalid migration filenames/);
  });
});
