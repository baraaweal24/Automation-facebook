import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import argon2 from 'argon2';
import { prisma } from '../src/index.js';

const terminal = createInterface({ input: stdin, output: stdout });
const username = process.env.ADMIN_USERNAME ?? await terminal.question('Admin username: ');
const email = process.env.ADMIN_EMAIL ?? await terminal.question('Admin email: ');
const password = process.env.ADMIN_PASSWORD ?? await terminal.question('Admin password (10+ chars): ');
terminal.close();
if (username.trim().length < 2 || !email.includes('@') || password.length < 10) throw new Error('Invalid admin details. Password must contain at least 10 characters.');
const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
await prisma.user.upsert({ where: { email }, create: { username, email, passwordHash }, update: { username, passwordHash, isActive: true } });
console.log('Admin account is ready.');
await prisma.$disconnect();
