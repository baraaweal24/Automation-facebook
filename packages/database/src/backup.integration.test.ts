import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backupDatabase, restoreDatabase, verifyBackup } from '../../../scripts/sqlite-backup.js';
it('backs up, verifies and restores content and attachments with automation stopped',()=>{
  const root=mkdtempSync(join(tmpdir(),'backup-rehearsal-'));const database=join(root,'app.db');const uploads=join(root,'uploads');const backups=join(root,'backups');
  try {
    const db=new DatabaseSync(database);
    db.exec(`CREATE TABLE SystemSetting(key TEXT,valueJson TEXT);INSERT INTO SystemSetting VALUES('automationState','"RUNNING"');CREATE TABLE AutomationTask(status TEXT,leaseToken TEXT,leaseExpiresAt TEXT);CREATE TABLE Post(status TEXT);INSERT INTO Post VALUES('POSTING');CREATE TABLE Session(id TEXT);CREATE TABLE Content(text TEXT);INSERT INTO Content VALUES('original');`);db.close();
    mkdirSync(uploads);writeFileSync(join(uploads,'image.txt'),'attachment');
    const backup=backupDatabase(database,uploads,backups);expect(verifyBackup(backup).files['app.db']).toBeTruthy();
    const changed=new DatabaseSync(database);changed.exec("UPDATE Content SET text='changed'");changed.close();
    writeFileSync(join(uploads,'image.txt'),'changed');
    const result=restoreDatabase(backup,database,uploads,backups);expect(result.previous).toBeTruthy();
    const restored=new DatabaseSync(database);expect(restored.prepare('SELECT text FROM Content').get()?.text).toBe('original');expect(restored.prepare('SELECT status FROM Post').get()?.status).toBe('MANUAL_ACTION_REQUIRED');expect(restored.prepare('SELECT valueJson FROM SystemSetting').get()?.valueJson).toBe('"STOPPED"');restored.close();
    expect(readFileSync(join(uploads,'image.txt'),'utf8')).toBe('attachment');
    writeFileSync(join(backup,'uploads/image.txt'),'tampered');expect(()=>verifyBackup(backup)).toThrow(/checksum/);
  } finally {rmSync(root,{recursive:true,force:true});}
});
