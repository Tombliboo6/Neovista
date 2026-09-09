import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export function createCreativeSessionRepository({ filePath, projectDirectory, validate }) {
  const parse = (targetPath) => validate(JSON.parse(readFileSync(targetPath, 'utf8')));
  const archivePath = (id) => resolve(projectDirectory, `${id}.json`);

  return {
    loadActive() {
      if (!existsSync(filePath)) return null;
      try { return parse(filePath); } catch { return null; }
    },

    readArchived(id) {
      const targetPath = archivePath(id);
      if (!existsSync(targetPath)) return null;
      try { return parse(targetPath); } catch { return null; }
    },

    listArchived() {
      if (!existsSync(projectDirectory)) return [];
      const sessions = [];
      for (const filename of readdirSync(projectDirectory)) {
        if (!/^[0-9a-f-]{36}\.json$/i.test(filename)) continue;
        try {
          const session = parse(resolve(projectDirectory, filename));
          if (session) sessions.push(session);
        } catch {
          // One damaged archive must not hide valid projects.
        }
      }
      return sessions;
    },

    archive(session) {
      writeJsonAtomically(archivePath(session.id), session);
    },

    activate(session) {
      writeJsonAtomically(filePath, session);
    },

    write(session) {
      this.activate(session);
      this.archive(session);
    },
  };
}

function writeJsonAtomically(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, filePath);
}
