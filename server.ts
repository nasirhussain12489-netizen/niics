import 'dotenv/config';
import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import https from 'https';
import * as dotenv from 'dotenv';
import { and, asc, desc, eq } from 'drizzle-orm';
import { createServer as createViteServer } from 'vite';
import { db, requireSqlDbForWrite } from './src/db/index.ts';
import {
  OFFLINE_ADMIN_USERS,
  OFFLINE_FEED_POSTS,
  OFFLINE_POSTERS,
  OFFLINE_WEEKLY_RESULTS,
  createFallbackBootstrapData,
  getOfflineAdminUser,
  isSqlConfigured,
  removeOfflineAdminUser,
  removeOfflineFeedPost,
  removeOfflineLibraryResource,
  removeOfflineWeeklyResult,
  upsertOfflineAdminUser,
  upsertOfflineFeedPost,
  upsertOfflineLibraryResource,
  upsertOfflinePoster,
  upsertOfflineWeeklyResult,
  validateAdminDelete,
} from './src/lib/bootstrap.ts';
import {
  activityLogs,
  classOfficers,
  classes,
  competitionCategories,
  feedPosts,
  libraryResources,
  participants,
  platformSettings,
  posters,
  students,
  users,
  weeklyResults,
} from './src/db/schema.ts';
import {
  CATEGORY_LIMITS,
  CLASS_OFFICER_ROLES,
  LIBRARY_CATEGORIES,
  RESULT_CATEGORIES,
  VALID_CATEGORIES,
  VALID_CLASSES,
  createParticipantWithPoster,
  createSessionToken,
  deleteParticipantWithPoster,
  ensureInitialSeedData,
  getUserByEmail,
  hashPassword,
  isValidClass,
  logActivity,
  regeneratePosterForClassCategory,
  updateParticipantWithPoster,
} from './src/db/repository.ts';
import {
  AuthRequest,
  canAccessClass,
  requireAuth,
  requireGlobalControl,
  requireSuperAdmin,
} from './src/middleware/auth.ts';
import {
  getSupabaseClient,
  getSupabaseUserByEmail,
  getSupabaseUsersByClass,
  hasSupabaseRuntimeConfig,
  testSupabaseConnection,
  createSupabaseAdminUser,
} from './src/lib/supabase.ts';
import { normalizeSettingsMap, safeObjectEntries } from './src/lib/settings.ts';
import { getSheetDBConfig } from './src/lib/sheetdb.ts';
import { GoogleGenAI } from '@google/genai';
import { isAiAssistantEnabled } from './src/types.ts';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export const app = express();
const PORT = 3000;

app.use(express.json({ limit: '20mb' }));

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve generated scholar portraits from src/assets/images
const generatedImagesDir = path.join(process.cwd(), 'src/assets/images');
if (fs.existsSync(generatedImagesDir)) {
  app.use(
    '/assets/images',
    express.static(generatedImagesDir, {
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'public, max-age=86400');
      },
    })
  );
}

// Serve uploaded files safely with nosniff to prevent script execution
app.use(
  '/uploads',
  express.static(uploadsDir, {
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'");
    },
  })
);

// Simple in-memory rate limiter for authentication endpoints
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record || now > record.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (record.count >= 20) {
    return false;
  }
  record.count += 1;
  return true;
}

function ensureSqlDatabaseReady(_res: Response, _operation: string) {
  if (!isSqlConfigured() && !hasSupabaseRuntimeConfig()) {
    console.warn('Offline/demo mode is active; using in-memory admin fallback storage.');
  }
  return true;
}

app.get('/api/system-status', (_req: Request, res: Response) => {
  const sqlConfigured = isSqlConfigured();
  const supabaseConfigured = hasSupabaseRuntimeConfig();
  const firebaseConfigured = Boolean(
    process.env.VITE_FIREBASE_API_KEY ||
      process.env.VITE_FIREBASE_PROJECT_ID ||
      process.env.VITE_FIREBASE_AUTH_DOMAIN ||
      (process.env as Record<string, string | undefined>).FIREBASE_API_KEY
  );

  res.json({
    ok: true,
    mode: sqlConfigured ? 'sql' : supabaseConfigured ? 'supabase' : 'offline',
    database: sqlConfigured ? 'postgres' : supabaseConfigured ? 'supabase' : 'offline',
    authProvider: 'firebase-or-supabase',
    firebaseConfigured,
    supabaseConfigured,
    sqlConfigured,
    message:
      sqlConfigured
        ? 'PostgreSQL is configured.'
        : supabaseConfigured
          ? 'Supabase is configured and active.'
          : 'No external database backend is configured; app is in offline demo mode.',
  });
});

// ============================================================================
// 1. PUBLIC WEBSITE ENDPOINTS (NO LOGIN REQUIRED, SANITIZED PUBLIC FIELDS)
// ============================================================================
async function getEffectiveAiSettings(): Promise<{
  enabled: boolean;
  geminiApiKey: string | null;
  chatApiKey: string | null;
}> {
  let geminiApiKey = process.env.GEMINI_API_KEY || '';
  let chatApiKey = process.env.CHAT_API_KEY || '';
  let enabled = isAiAssistantEnabled(process.env.AI_ASSISTANT_ENABLED);

  try {
    const records = await db.select().from(platformSettings);
    const map = normalizeSettingsMap(records);

    if (!enabled && map.aiAssistantEnabled) {
      enabled = isAiAssistantEnabled(map.aiAssistantEnabled);
    }

    if (!geminiApiKey && map.geminiApiKey) {
      geminiApiKey = String(map.geminiApiKey).trim();
    }

    if (!chatApiKey && map.chatApiKey) {
      chatApiKey = String(map.chatApiKey).trim();
    }
  } catch (err) {
    console.warn('Could not read AI assistant settings from platformSettings:', err);
  }

  return {
    enabled,
    geminiApiKey: geminiApiKey.trim() || null,
    chatApiKey: chatApiKey.trim() || null,
  };
}

app.get('/api/public/bootstrap', async (_req: Request, res: Response) => {
  try {
    if (!isSqlConfigured() && !hasSupabaseRuntimeConfig()) {
      console.warn('No database backend configured. Serving offline demo bootstrap data.');
      return res.json(createFallbackBootstrapData());
    }

    if (!isSqlConfigured() && hasSupabaseRuntimeConfig()) {
      return res.json(createFallbackBootstrapData());
    }

    try {
      await ensureInitialSeedData();

      const [
        allClasses,
        allCategories,
        allStudents,
        allOfficers,
        allParticipants,
        allPosters,
        allFeedPosts,
        allResults,
        allLibrary,
        allSettings,
      ] = await Promise.all([
        db.select().from(classes).orderBy(asc(classes.code)),
        db
          .select()
          .from(competitionCategories)
          .orderBy(asc(competitionCategories.displayOrder)),
        db
          .select()
          .from(students)
          .orderBy(asc(students.classCode), asc(students.admissionNo)),
        db
          .select()
          .from(classOfficers)
          .orderBy(asc(classOfficers.classCode), asc(classOfficers.id)),
        db
          .select()
          .from(participants)
          .where(eq(participants.publicationStatus, 'PUBLISHED'))
          .orderBy(asc(participants.classCode), asc(participants.id)),
        db
          .select()
          .from(posters)
          .where(eq(posters.publicationStatus, 'PUBLISHED'))
          .orderBy(desc(posters.isFeatured), desc(posters.updatedAt), asc(posters.id)),
        db
          .select()
          .from(feedPosts)
          .orderBy(desc(feedPosts.createdAt)),
        db
          .select()
          .from(weeklyResults)
          .where(eq(weeklyResults.publicationStatus, 'PUBLISHED'))
          .orderBy(desc(weeklyResults.resultDate), desc(weeklyResults.id)),
        db
          .select()
          .from(libraryResources)
          .where(eq(libraryResources.publicationStatus, 'PUBLISHED'))
          .orderBy(desc(libraryResources.createdAt)),
        db.select().from(platformSettings),
      ]);

      const publicParticipants = allParticipants.map((p) => ({
      id: p.id,
      admissionNo: p.admissionNo,
      fullName: p.fullName,
      photoUrl: p.photoUrl,
      classCode: p.classCode,
      categoryName: p.categoryName,
      ownTopic: p.ownTopic,
      shortDescription: p.shortDescription,
    }));

    // Sanitize public feed posts (include all non-rejected feed posts so anything posted to feed shows on public Home)
    const publicFeed = allFeedPosts
      .filter((fp) => fp.status !== 'REJECTED')
      .map((fp) => ({
        id: fp.id,
        classCode: fp.classCode,
        title: fp.title,
        caption: fp.caption,
        mediaUrl: fp.mediaUrl,
        mediaType: fp.mediaType,
        submittedByName: fp.submittedByName,
        createdAt: fp.createdAt,
      }));

    // Sanitize public weekly results (no admin emails)
    const publicResults = allResults.map((r) => ({
      id: r.id,
      resultCategory: r.resultCategory,
      winnerName: r.winnerName,
      winnerPhotoUrl: r.winnerPhotoUrl,
      winnerClass: r.winnerClass,
      weekLabel: r.weekLabel,
      resultDate: r.resultDate,
      remarks: r.remarks,
      createdAt: r.createdAt,
    }));

    // Sanitize public library resources
    const publicLibrary = allLibrary.map((lr) => ({
      id: lr.id,
      title: lr.title,
      description: lr.description,
      author: lr.author,
      category: lr.category,
      libraryScope: lr.libraryScope,
      fileUrl: lr.fileUrl,
      fileType: lr.fileType,
      fileSize: lr.fileSize,
      contentPreview: lr.contentPreview,
      createdAt: lr.createdAt,
    }));

    const settingsMap: Record<string, string> = {};
    for (const s of allSettings) {
      settingsMap[s.settingKey] = s.settingValue;
    }

    res.json({
      classes: allClasses.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        description: c.description,
      })),
      categories: allCategories,
      students: allStudents.map((s) => ({
        id: s.id,
        admissionNo: s.admissionNo,
        fullName: s.fullName,
        classCode: s.classCode,
        photoUrl: s.photoUrl,
        bio: s.bio,
      })),
      classOfficers: allOfficers.map((o) => ({
        id: o.id,
        classCode: o.classCode,
        roleTitle: o.roleTitle,
        holderName: o.holderName,
        admissionNo: o.admissionNo,
        photoUrl: o.photoUrl,
        responsibilities: o.responsibilities,
      })),
      participants: publicParticipants,
      posters: allPosters,
      feedPosts: publicFeed,
      weeklyResults: publicResults,
      libraryResources: publicLibrary,
      settings: settingsMap,
    });
    } catch (dbError: any) {
      console.warn('Database unavailable during bootstrap. Serving offline fallback data.', dbError);
      return res.json(createFallbackBootstrapData());
    }
  } catch (error: any) {
    console.error('Error in /api/public/bootstrap:', error);
    res
      .json(createFallbackBootstrapData());
  }
});

app.post('/api/public/ai/chat', async (req: Request, res: Response) => {
  try {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) {
      return res.status(400).json({ error: 'A message is required to ask the AI assistant.' });
    }

    const aiSettings = await getEffectiveAiSettings();
    if (!aiSettings.enabled) {
      return res.status(403).json({ error: 'The AI assistant is currently turned off.' });
    }

    const geminiKey = aiSettings.geminiApiKey || process.env.GEMINI_API_KEY || '';
    if (!geminiKey) {
      return res.status(503).json({ error: 'Gemini API key is not configured for the AI assistant.' });
    }

    const ai = new GoogleGenAI({ apiKey: geminiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: message,
      config: {
        temperature: 0.25,
      },
    });

    const answer = typeof response?.text === 'string' && response.text.trim()
      ? response.text.trim()
      : 'I am ready to help, but no answer was returned from the model.';

    return res.json({
      answer,
      historyStored: false,
      assistant: 'Gemini',
    });
  } catch (error: any) {
    console.error('AI chat error:', error);
    return res.status(500).json({
      error: error?.message || 'The AI assistant could not generate a response.',
    });
  }
});

// ============================================================================
// 2. ADMINISTRATOR AUTHENTICATION ENDPOINTS
// ============================================================================
app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(ip)) {
      return res.status(429).json({
        error: 'Too many login attempts. Please wait a minute before trying again.',
      });
    }

    await ensureInitialSeedData();

    const { email, password } = req.body || {};
    if (!email || !password) {
      return res
        .status(400)
        .json({ error: 'Administrator email and password are required.' });
    }

    const dbUser = await getUserByEmail(String(email));
    if (!dbUser || !dbUser.passwordHash) {
      return res
        .status(401)
        .json({ error: 'Invalid administrator email or password.' });
    }

    if (dbUser.status !== 'ACTIVE') {
      return res.status(403).json({
        error: 'This administrator account has been deactivated by the Super Admin.',
      });
    }

    const incomingHash = hashPassword(String(password));
    if (incomingHash !== dbUser.passwordHash) {
      return res
        .status(401)
        .json({ error: 'Invalid administrator email or password.' });
    }

    const token = createSessionToken({
      uid: dbUser.uid,
      email: dbUser.email,
      role: dbUser.role,
      assignedClass: dbUser.assignedClass,
    });

    await logActivity({
      actorEmail: dbUser.email,
      actorRole: dbUser.role,
      action: 'ADMIN_LOGIN',
      targetType: 'AUTH',
      classCode: dbUser.assignedClass || undefined,
      details: `${dbUser.name} (${dbUser.role}) signed in to the administration portal.`,
    });

    return res.json({
      token,
      user: {
        id: dbUser.id,
        uid: dbUser.uid,
        email: dbUser.email,
        name: dbUser.name,
        role: dbUser.role,
        assignedClass: dbUser.assignedClass,
        status: dbUser.status,
      },
    });
  } catch (error: any) {
    console.error('Login failed:', error);
    return res.status(500).json({ error: 'Authentication service failed.' });
  }
});

app.post('/api/auth/password-reset', async (req: Request, res: Response) => {
  try {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(ip)) {
      return res.status(429).json({ error: 'Too many requests. Please wait.' });
    }

    const { email, currentPassword, newPassword } = req.body || {};
    if (!email || !currentPassword || !newPassword) {
      return res.status(400).json({
        error: 'Email, current password, and new password (min 8 chars) are required.',
      });
    }
    if (String(newPassword).length < 8) {
      return res
        .status(400)
        .json({ error: 'New password must be at least 8 characters long.' });
    }

    const dbUser = await getUserByEmail(String(email));
    if (!dbUser || dbUser.passwordHash !== hashPassword(String(currentPassword))) {
      return res
        .status(401)
        .json({ error: 'Invalid email or current password verification.' });
    }

    await db
      .update(users)
      .set({
        passwordHash: hashPassword(String(newPassword)),
        passwordPlain: String(newPassword),
        updatedAt: new Date(),
      })
      .where(eq(users.id, dbUser.id));

    await logActivity({
      actorEmail: dbUser.email,
      actorRole: dbUser.role,
      action: 'PASSWORD_RESET',
      targetType: 'USER',
      targetId: String(dbUser.id),
      details: `Administrator ${dbUser.email} updated their account password.`,
    });

    return res.json({ message: 'Password updated successfully. You may now log in.' });
  } catch (error) {
    console.error('Password reset error:', error);
    return res.status(500).json({ error: 'Failed to update password.' });
  }
});

app.get('/api/auth/me', requireAuth, async (req: AuthRequest, res: Response) => {
  return res.json({ user: req.adminUser });
});

// ============================================================================
// 3. PROTECTED ADMIN DASHBOARD DATA ENDPOINT (STRICT CLASS ISOLATION)
// ============================================================================
app.get(
  '/api/admin/dashboard',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      await ensureInitialSeedData();
      const admin = req.adminUser!;

      if (!isSqlConfigured() && !hasSupabaseRuntimeConfig()) {
        const fallback = createFallbackBootstrapData();
        const usersList =
          admin.role === 'SUPER_ADMIN'
            ? OFFLINE_ADMIN_USERS.map((u) => ({
                id: u.id,
                uid: u.uid,
                email: u.email,
                name: u.name,
                role: u.role,
                assignedClass: u.assignedClass,
                status: u.status,
                passwordPlain: u.passwordPlain || '',
                createdAt: new Date(),
                updatedAt: new Date(),
              }))
            : [];

        return res.json({
          user: admin,
          classes: fallback.classes,
          categories: fallback.categories,
          students: fallback.students,
          classOfficers: fallback.classOfficers,
          participants: fallback.participants,
          posters: fallback.posters,
          feedPosts: fallback.feedPosts,
          weeklyResults: fallback.weeklyResults,
          libraryResources: fallback.libraryResources,
          users: usersList,
          activityLogs: [],
          settings: {
            supabaseUrl: process.env.SUPABASE_URL || '',
            supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
            supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
            imgbbApiKey: process.env.IMGBB_API_KEY || '',
          },
        });
      }

      if (hasSupabaseRuntimeConfig()) {
        const client = getSupabaseClient();
        const fallback = createFallbackBootstrapData();
        const usersList =
          admin.role === 'SUPER_ADMIN' && client
            ? ((await client.from('users').select('*').order('role', { ascending: true }).order('assigned_class', { ascending: true })).data || []).map((row: any) => ({
                id: Number(row.id),
                uid: row.uid,
                email: row.email,
                name: row.name,
                role: row.role,
                assignedClass: row.assigned_class || null,
                status: row.status,
                passwordPlain: row.password_plain || '',
                createdAt: row.created_at ? new Date(row.created_at) : new Date(),
                updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
              }))
            : [];

        return res.json({
          user: admin,
          classes: fallback.classes,
          categories: fallback.categories,
          students: fallback.students,
          classOfficers: fallback.classOfficers,
          participants: fallback.participants,
          posters: fallback.posters,
          feedPosts: fallback.feedPosts,
          weeklyResults: fallback.weeklyResults,
          libraryResources: fallback.libraryResources,
          users: usersList,
          activityLogs: [],
          settings: {
            supabaseUrl: process.env.SUPABASE_URL || '',
            supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
            supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
            imgbbApiKey: process.env.IMGBB_API_KEY || '',
          },
        });
      }

      const allCategories = await db
        .select()
        .from(competitionCategories)
        .orderBy(asc(competitionCategories.displayOrder));

      const allResults = await db
        .select()
        .from(weeklyResults)
        .orderBy(desc(weeklyResults.resultDate), desc(weeklyResults.id));

      if (admin.role === 'SUPER_ADMIN' || admin.role === 'TEACHER') {
        const [
          allClasses,
          allStudents,
          allOfficers,
          allParticipants,
          allPosters,
          allFeed,
          allLibrary,
          allUsers,
          allLogs,
          allSettings,
        ] = await Promise.all([
          db.select().from(classes).orderBy(asc(classes.code)),
          db
            .select()
            .from(students)
            .orderBy(asc(students.classCode), asc(students.admissionNo)),
          db
            .select()
            .from(classOfficers)
            .orderBy(asc(classOfficers.classCode), asc(classOfficers.id)),
          db
            .select()
            .from(participants)
            .orderBy(asc(participants.classCode), desc(participants.id)),
          db
            .select()
            .from(posters)
            .orderBy(asc(posters.classCode), desc(posters.updatedAt)),
          db.select().from(feedPosts).orderBy(desc(feedPosts.createdAt)),
          db
            .select()
            .from(libraryResources)
            .orderBy(desc(libraryResources.createdAt)),
          admin.role === 'SUPER_ADMIN'
            ? db.select().from(users).orderBy(asc(users.role), asc(users.assignedClass))
            : Promise.resolve([]),
          db
            .select()
            .from(activityLogs)
            .orderBy(desc(activityLogs.createdAt))
            .limit(100),
          db.select().from(platformSettings),
        ]);

        const settingsMap: Record<string, string> = {};
        for (const s of allSettings) {
          settingsMap[s.settingKey] = s.settingValue;
        }
        if (!settingsMap.supabaseUrl && process.env.SUPABASE_URL) {
          settingsMap.supabaseUrl = process.env.SUPABASE_URL;
        }
        if (!settingsMap.supabaseAnonKey && process.env.SUPABASE_ANON_KEY) {
          settingsMap.supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
        }
        if (!settingsMap.supabaseServiceKey && process.env.SUPABASE_SERVICE_ROLE_KEY) {
          settingsMap.supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        }
        if (!settingsMap.imgbbApiKey && process.env.IMGBB_API_KEY) {
          settingsMap.imgbbApiKey = process.env.IMGBB_API_KEY;
        }

        return res.json({
          user: admin,
          classes: allClasses,
          categories: allCategories,
          students: allStudents,
          classOfficers: allOfficers,
          participants: allParticipants,
          posters: allPosters,
          feedPosts: allFeed,
          weeklyResults: allResults,
          libraryResources: allLibrary,
          users:
            admin.role === 'SUPER_ADMIN'
              ? allUsers.map((u) => ({
                  id: u.id,
                  uid: u.uid,
                  email: u.email,
                  name: u.name,
                  role: u.role,
                  assignedClass: u.assignedClass,
                  status: u.status,
                  passwordPlain: u.passwordPlain || '',
                  createdAt: u.createdAt,
                  updatedAt: u.updatedAt,
                }))
              : [],
          activityLogs: allLogs,
          settings: settingsMap,
        });
      }

      // CLASS_ADMIN: Strictly isolate all data to admin.assignedClass
      const assignedClass = admin.assignedClass;
      if (!assignedClass || !isValidClass(assignedClass)) {
        return res.status(403).json({
          error: 'Class Admin account does not have a valid assigned class (U1–U6).',
        });
      }

      const [
        assignedClassRows,
        classStudents,
        classOfficersRows,
        classParticipants,
        classPosters,
        classFeed,
        classLibrary,
        classLogs,
      ] = await Promise.all([
        db.select().from(classes).where(eq(classes.code, assignedClass)),
        db
          .select()
          .from(students)
          .where(eq(students.classCode, assignedClass))
          .orderBy(asc(students.admissionNo)),
        db
          .select()
          .from(classOfficers)
          .where(eq(classOfficers.classCode, assignedClass))
          .orderBy(asc(classOfficers.id)),
        db
          .select()
          .from(participants)
          .where(eq(participants.classCode, assignedClass))
          .orderBy(desc(participants.id)),
        db
          .select()
          .from(posters)
          .where(eq(posters.classCode, assignedClass))
          .orderBy(desc(posters.updatedAt)),
        db
          .select()
          .from(feedPosts)
          .where(eq(feedPosts.classCode, assignedClass))
          .orderBy(desc(feedPosts.createdAt)),
        db
          .select()
          .from(libraryResources)
          .where(eq(libraryResources.libraryScope, assignedClass))
          .orderBy(desc(libraryResources.createdAt)),
        db
          .select()
          .from(activityLogs)
          .where(eq(activityLogs.classCode, assignedClass))
          .orderBy(desc(activityLogs.createdAt))
          .limit(50),
      ]);

      return res.json({
        user: admin,
        classes: assignedClassRows,
        categories: allCategories,
        students: classStudents,
        classOfficers: classOfficersRows,
        participants: classParticipants,
        posters: classPosters,
        feedPosts: classFeed,
        weeklyResults: allResults.filter(
          (r) => r.publicationStatus === 'PUBLISHED'
        ),
        libraryResources: classLibrary,
        users: [],
        activityLogs: classLogs,
        settings: {},
      });
    } catch (error: any) {
      console.warn('SQL-backed dashboard query failed; serving offline fallback admin payload.', error);
      const admin = req.adminUser!;
      const fallback = createFallbackBootstrapData();
      return res.json({
        user: admin,
        classes: fallback.classes,
        categories: fallback.categories,
        students: fallback.students,
        classOfficers: fallback.classOfficers,
        participants: fallback.participants,
        posters: fallback.posters,
        feedPosts: fallback.feedPosts,
        weeklyResults: fallback.weeklyResults,
        libraryResources: fallback.libraryResources,
        users: admin.role === 'SUPER_ADMIN' ? OFFLINE_ADMIN_USERS.map((u) => ({
          id: u.id,
          uid: u.uid,
          email: u.email,
          name: u.name,
          role: u.role,
          assignedClass: u.assignedClass,
          status: u.status,
          passwordPlain: u.passwordPlain || '',
          createdAt: new Date(),
          updatedAt: new Date(),
        })) : [],
        activityLogs: [],
        settings: {
          supabaseUrl: process.env.SUPABASE_URL || '',
          supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
          supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
          imgbbApiKey: process.env.IMGBB_API_KEY || '',
        },
      });
    }
  }
);

// ============================================================================
// 4. PARTICIPANT MANAGEMENT & AUTOMATIC POSTER GENERATION
// ============================================================================
app.post(
  '/api/admin/participants',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const admin = req.adminUser!;
      const {
        admissionNo,
        fullName,
        photoUrl,
        classCode,
        categoryName,
        ownTopic,
        shortDescription,
        publicationStatus,
      } = req.body || {};

      const targetClass =
        admin.role === 'CLASS_ADMIN' ? admin.assignedClass! : String(classCode || '');

      if (
        admin.role === 'CLASS_ADMIN' &&
        classCode &&
        classCode !== admin.assignedClass
      ) {
        return res.status(403).json({
          error: `Forbidden: Class Admin for ${admin.assignedClass} cannot add participants to class ${classCode}.`,
        });
      }

      if (!canAccessClass(admin, targetClass)) {
        return res.status(403).json({
          error: 'Forbidden: You do not have permission to manage this class.',
        });
      }

      let resolvedPhotoUrl = String(photoUrl || '');
      if (resolvedPhotoUrl.startsWith('data:image/')) {
        const base64Clean = resolvedPhotoUrl.split(',')[1] || resolvedPhotoUrl;
        const imgbbUrl = await uploadToImgBB(
          base64Clean,
          `participant_${admissionNo || Date.now()}`
        );
        if (imgbbUrl) {
          resolvedPhotoUrl = imgbbUrl;
        }
      }

      const result = await createParticipantWithPoster({
        admissionNo: admissionNo ? String(admissionNo) : undefined,
        fullName: String(fullName || ''),
        photoUrl: resolvedPhotoUrl,
        classCode: targetClass,
        categoryName: String(categoryName || ''),
        ownTopic: ownTopic ? String(ownTopic) : undefined,
        shortDescription: shortDescription ? String(shortDescription) : undefined,
        publicationStatus: publicationStatus || 'PUBLISHED',
        actorEmail: admin.email,
        actorRole: admin.role,
      });

      return res.status(201).json(result);
    } catch (error: any) {
      return res.status(400).json({
        error: error.message || 'Failed to register participant.',
      });
    }
  }
);

app.put(
  '/api/admin/participants/:id',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const admin = req.adminUser!;
      const participantId = Number(req.params.id);
      if (!participantId) {
        return res.status(400).json({ error: 'Valid participant ID is required.' });
      }

      const existingRows = await db
        .select()
        .from(participants)
        .where(eq(participants.id, participantId));

      if (existingRows.length === 0) {
        return res.status(404).json({ error: 'Participant not found.' });
      }

      const existing = existingRows[0];
      if (!canAccessClass(admin, existing.classCode)) {
        return res.status(403).json({
          error: `Forbidden: You cannot modify participants in class ${existing.classCode}.`,
        });
      }

      const {
        admissionNo,
        fullName,
        photoUrl,
        classCode,
        categoryName,
        ownTopic,
        shortDescription,
        publicationStatus,
      } = req.body || {};

      if (classCode && !canAccessClass(admin, String(classCode))) {
        return res.status(403).json({
          error: `Forbidden: You cannot transfer participants to class ${classCode}.`,
        });
      }

      let resolvedPhotoUrl = photoUrl !== undefined ? String(photoUrl || '') : existing.photoUrl;
      if (resolvedPhotoUrl && resolvedPhotoUrl.startsWith('data:image/')) {
        const base64Clean = resolvedPhotoUrl.split(',')[1] || resolvedPhotoUrl;
        const imgbbUrl = await uploadToImgBB(
          base64Clean,
          `participant_${admissionNo || existing.admissionNo || Date.now()}`
        );
        if (imgbbUrl) {
          resolvedPhotoUrl = imgbbUrl;
        }
      }

      const result = await updateParticipantWithPoster({
        id: participantId,
        admissionNo,
        fullName,
        photoUrl: resolvedPhotoUrl,
        classCode,
        categoryName,
        ownTopic,
        shortDescription,
        publicationStatus,
        actorEmail: admin.email,
        actorRole: admin.role,
      });

      return res.json(result);
    } catch (error: any) {
      return res
        .status(400)
        .json({ error: error.message || 'Failed to update participant.' });
    }
  }
);

app.delete(
  '/api/admin/participants/:id',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const admin = req.adminUser!;
      const participantId = Number(req.params.id);
      if (!participantId) {
        return res.status(400).json({ error: 'Valid participant ID is required.' });
      }

      const existingRows = await db
        .select()
        .from(participants)
        .where(eq(participants.id, participantId));

      if (existingRows.length === 0) {
        return res.status(404).json({ error: 'Participant not found.' });
      }

      const existing = existingRows[0];
      if (!canAccessClass(admin, existing.classCode)) {
        return res.status(403).json({
          error: `Forbidden: You cannot remove participants from class ${existing.classCode}.`,
        });
      }

      const result = await deleteParticipantWithPoster({
        id: participantId,
        actorEmail: admin.email,
        actorRole: admin.role,
      });

      return res.json(result);
    } catch (error: any) {
      return res
        .status(400)
        .json({ error: error.message || 'Failed to delete participant.' });
    }
  }
);

// ============================================================================
// 4B. STUDENTS ROSTER ENDPOINTS (ADMISSION NO + NAME + CLASS ISOLATION)
// ============================================================================
app.post(
  '/api/admin/students',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const admin = req.adminUser!;
      const { admissionNo, fullName, classCode, photoUrl, bio } = req.body || {};

      const targetClass =
        admin.role === 'CLASS_ADMIN'
          ? admin.assignedClass!
          : String(classCode || '');

      if (
        admin.role === 'CLASS_ADMIN' &&
        classCode &&
        classCode !== admin.assignedClass
      ) {
        return res.status(403).json({
          error: `Forbidden: Class Admin for ${admin.assignedClass} can only add students to ${admin.assignedClass}.`,
        });
      }

      if (!isValidClass(targetClass)) {
        return res
          .status(400)
          .json({ error: 'Valid class (U1–U6) is required for student registration.' });
      }
      if (!admissionNo || !String(admissionNo).trim()) {
        return res
          .status(400)
          .json({ error: 'Student Admission Number is required.' });
      }
      if (!fullName || !String(fullName).trim()) {
        return res
          .status(400)
          .json({ error: 'Student full name is required.' });
      }

      const cleanAdm = String(admissionNo).trim();
      if (!ensureSqlDatabaseReady(res, 'Student registration')) {
        return;
      }
      const existingAdm = await db
        .select()
        .from(students)
        .where(eq(students.admissionNo, cleanAdm));

      if (existingAdm.length > 0) {
        return res.status(400).json({
          error: `A student with Admission No "${cleanAdm}" is already registered (${existingAdm[0].fullName} in ${existingAdm[0].classCode}).`,
        });
      }

      const inserted = await db
        .insert(students)
        .values({
          admissionNo: cleanAdm,
          fullName: String(fullName).trim(),
          classCode: targetClass,
          photoUrl:
            photoUrl && String(photoUrl).trim()
              ? String(photoUrl).trim()
              : '/assets/images/scholar_portrait_ahmed_1791787523001.jpg',
          bio: bio ? String(bio).trim() : null,
          createdByEmail: admin.email,
        })
        .returning();

      await logActivity({
        actorEmail: admin.email,
        actorRole: admin.role,
        action: 'ADD_STUDENT',
        targetType: 'STUDENT',
        targetId: String(inserted[0].id),
        classCode: targetClass,
        details: `Added student ${inserted[0].fullName} (Admission No: ${inserted[0].admissionNo}) to Class ${targetClass}.`,
      });

      return res.status(201).json({ student: inserted[0] });
    } catch (error: any) {
      return res
        .status(400)
        .json({ error: error.message || 'Failed to register student.' });
    }
  }
);

app.put(
  '/api/admin/students/:id',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const admin = req.adminUser!;
      const studentId = Number(req.params.id);
      const existingRows = await db
        .select()
        .from(students)
        .where(eq(students.id, studentId));

      if (existingRows.length === 0) {
        return res.status(404).json({ error: 'Student record not found.' });
      }
      const existing = existingRows[0];

      if (!canAccessClass(admin, existing.classCode)) {
        return res.status(403).json({
          error: `Forbidden: You cannot edit students in Class ${existing.classCode}.`,
        });
      }

      const { admissionNo, fullName, classCode, photoUrl, bio } = req.body || {};
      const targetClass =
        admin.role === 'CLASS_ADMIN'
          ? admin.assignedClass!
          : String(classCode || existing.classCode);

      if (!isValidClass(targetClass)) {
        return res.status(400).json({ error: 'Valid class (U1–U6) is required.' });
      }

      const updated = await db
        .update(students)
        .set({
          admissionNo: admissionNo
            ? String(admissionNo).trim()
            : existing.admissionNo,
          fullName: fullName ? String(fullName).trim() : existing.fullName,
          classCode: targetClass,
          photoUrl: photoUrl ? String(photoUrl).trim() : existing.photoUrl,
          bio: bio !== undefined ? (bio ? String(bio).trim() : null) : existing.bio,
          updatedAt: new Date(),
        })
        .where(eq(students.id, studentId))
        .returning();

      // Sync matching participant records (by admissionNo) and regenerate poster so updated student photo/name appears on the poster immediately
      if (existing.admissionNo) {
        await db
          .update(participants)
          .set({
            admissionNo: updated[0].admissionNo,
            fullName: updated[0].fullName,
            photoUrl: updated[0].photoUrl,
            classCode: targetClass,
            updatedAt: new Date(),
          })
          .where(eq(participants.admissionNo, existing.admissionNo));
      }
      await regeneratePosterForClassCategory(targetClass, 'All Categories');
      if (existing.classCode !== targetClass) {
        await regeneratePosterForClassCategory(existing.classCode, 'All Categories');
      }

      await logActivity({
        actorEmail: admin.email,
        actorRole: admin.role,
        action: 'UPDATE_STUDENT',
        targetType: 'STUDENT',
        targetId: String(studentId),
        classCode: targetClass,
        details: `Updated student ${updated[0].fullName} (Admission No: ${updated[0].admissionNo}) in Class ${targetClass}.`,
      });

      return res.json({ student: updated[0] });
    } catch (error: any) {
      return res
        .status(400)
        .json({ error: error.message || 'Failed to update student.' });
    }
  }
);

app.delete(
  '/api/admin/students/:id',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const admin = req.adminUser!;
      const studentId = Number(req.params.id);
      const existingRows = await db
        .select()
        .from(students)
        .where(eq(students.id, studentId));

      if (existingRows.length === 0) {
        return res.status(404).json({ error: 'Student record not found.' });
      }
      const existing = existingRows[0];

      if (!canAccessClass(admin, existing.classCode)) {
        return res.status(403).json({
          error: `Forbidden: You cannot remove students from Class ${existing.classCode}.`,
        });
      }

      await db.delete(students).where(eq(students.id, studentId));

      await logActivity({
        actorEmail: admin.email,
        actorRole: admin.role,
        action: 'DELETE_STUDENT',
        targetType: 'STUDENT',
        targetId: String(studentId),
        classCode: existing.classCode,
        details: `Removed student ${existing.fullName} (${existing.admissionNo}) from Class ${existing.classCode}.`,
      });

      return res.json({ deletedId: studentId });
    } catch (error: any) {
      return res
        .status(400)
        .json({ error: error.message || 'Failed to delete student.' });
    }
  }
);

// ============================================================================
// 4C. CLASS OFFICERS & CLASS TEACHER ENDPOINTS
// ============================================================================
app.post(
  '/api/admin/class-officers',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const admin = req.adminUser!;
      const {
        classCode,
        roleTitle,
        holderName,
        admissionNo,
        photoUrl,
        responsibilities,
      } = req.body || {};

      const targetClass =
        admin.role === 'CLASS_ADMIN'
          ? admin.assignedClass!
          : String(classCode || '');

      if (!canAccessClass(admin, targetClass)) {
        return res.status(403).json({
          error: `Forbidden: You can only manage Class Teacher & Officers for Class ${admin.assignedClass}.`,
        });
      }

      if (!isValidClass(targetClass)) {
        return res.status(400).json({
          error: 'Valid class (U1–U6) is required for Class Officer assignment.',
        });
      }

      if (
        !CLASS_OFFICER_ROLES.includes(
          roleTitle as (typeof CLASS_OFFICER_ROLES)[number]
        )
      ) {
        return res.status(400).json({
          error: `Invalid role. Allowed roles: ${CLASS_OFFICER_ROLES.join(
            ', '
          )}.`,
        });
      }

      if (!holderName || !String(holderName).trim()) {
        return res
          .status(400)
          .json({ error: 'Full name is required.' });
      }

      const existingOfficer = await db
        .select()
        .from(classOfficers)
        .where(
          and(
            eq(classOfficers.classCode, targetClass),
            eq(classOfficers.roleTitle, String(roleTitle))
          )
        );

      let savedOfficer;
      if (existingOfficer.length > 0) {
        const updated = await db
          .update(classOfficers)
          .set({
            holderName: String(holderName).trim(),
            admissionNo: admissionNo ? String(admissionNo).trim() : null,
            photoUrl:
              photoUrl && String(photoUrl).trim()
                ? String(photoUrl).trim()
                : existingOfficer[0].photoUrl,
            responsibilities: responsibilities
              ? String(responsibilities).trim()
              : null,
            updatedByEmail: admin.email,
            updatedAt: new Date(),
          })
          .where(eq(classOfficers.id, existingOfficer[0].id))
          .returning();
        savedOfficer = updated[0];
      } else {
        const inserted = await db
          .insert(classOfficers)
          .values({
            classCode: targetClass,
            roleTitle: String(roleTitle),
            holderName: String(holderName).trim(),
            admissionNo: admissionNo ? String(admissionNo).trim() : null,
            photoUrl:
              photoUrl && String(photoUrl).trim()
                ? String(photoUrl).trim()
                : '/assets/images/scholar_portrait_ahmed_1791787523001.jpg',
            responsibilities: responsibilities
              ? String(responsibilities).trim()
              : null,
            updatedByEmail: admin.email,
          })
          .returning();
        savedOfficer = inserted[0];
      }

      await logActivity({
        actorEmail: admin.email,
        actorRole: admin.role,
        action:
          existingOfficer.length > 0
            ? 'UPDATE_CLASS_OFFICER'
            : 'ASSIGN_CLASS_OFFICER',
        targetType: 'CLASS_OFFICER',
        targetId: String(savedOfficer.id),
        classCode: targetClass,
        details: `${admin.name} appointed ${savedOfficer.holderName} as ${savedOfficer.roleTitle} for Class ${targetClass}.`,
      });

      return res.status(201).json({ officer: savedOfficer });
    } catch (error: any) {
      return res
        .status(400)
        .json({ error: error.message || 'Failed to save Class Officer.' });
    }
  }
);

app.delete(
  '/api/admin/class-officers/:id',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const admin = req.adminUser!;
      const officerId = Number(req.params.id);
      const existingRows = await db
        .select()
        .from(classOfficers)
        .where(eq(classOfficers.id, officerId));

      if (existingRows.length === 0) {
        return res.status(404).json({ error: 'Class Officer record not found.' });
      }
      const existing = existingRows[0];

      if (!canAccessClass(admin, existing.classCode)) {
        return res.status(403).json({
          error: 'Forbidden: You cannot remove officers from another class.',
        });
      }

      await db.delete(classOfficers).where(eq(classOfficers.id, officerId));

      await logActivity({
        actorEmail: admin.email,
        actorRole: admin.role,
        action: 'REMOVE_CLASS_OFFICER',
        targetType: 'CLASS_OFFICER',
        targetId: String(officerId),
        classCode: existing.classCode,
        details: `${admin.name} removed ${existing.holderName} (${existing.roleTitle}) from Class ${existing.classCode}.`,
      });

      return res.json({ deletedId: officerId });
    } catch (error: any) {
      return res
        .status(400)
        .json({ error: error.message || 'Failed to remove Class Officer.' });
    }
  }
);

// ============================================================================
// 5. POSTERS MANAGEMENT ENDPOINTS
// ============================================================================
app.post(
  '/api/admin/posters/regenerate',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const admin = req.adminUser!;
      const { classCode, categoryName } = req.body || {};
      const targetClass =
        admin.role === 'CLASS_ADMIN' ? admin.assignedClass! : String(classCode || '');

      if (!canAccessClass(admin, targetClass)) {
        return res.status(403).json({
          error: 'Forbidden: You cannot regenerate posters for another class.',
        });
      }

      const poster = await regeneratePosterForClassCategory(
        targetClass,
        String(categoryName || 'All Categories')
      );

      await logActivity({
        actorEmail: admin.email,
        actorRole: admin.role,
        action: 'REGENERATE_POSTER',
        targetType: 'POSTER',
        targetId: String(poster.id),
        classCode: targetClass,
        details: `Regenerated unified 1-page Master Class Poster for Class ${targetClass}.`,
      });

      return res.json({ poster });
    } catch (error: any) {
      return res
        .status(400)
        .json({ error: error.message || 'Failed to regenerate poster.' });
    }
  }
);

app.delete(
  '/api/admin/posters/:id',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const admin = req.adminUser!;
      const posterId = Number(req.params.id);

      if (!posterId) {
        return res.status(400).json({ error: 'Valid poster ID is required.' });
      }

      if (!isSqlConfigured() && !hasSupabaseRuntimeConfig()) {
        return res.json({
          deleted: true,
          posterId,
          message: 'Offline poster preview removed from the demo dashboard.',
        });
      }

      const existingRows = await db
        .select()
        .from(posters)
        .where(eq(posters.id, posterId));

      if (existingRows.length === 0) {
        return res.status(404).json({ error: 'Poster not found.' });
      }

      const existing = existingRows[0];
      if (!canAccessClass(admin, existing.classCode)) {
        return res.status(403).json({
          error: `Forbidden: You cannot delete posters for class ${existing.classCode}.`,
        });
      }

      await db.delete(posters).where(eq(posters.id, posterId));

      return res.json({
        deleted: true,
        posterId,
        classCode: existing.classCode,
      });
    } catch (error: any) {
      return res.status(400).json({ error: error.message || 'Failed to delete poster.' });
    }
  }
);

app.patch(
  '/api/admin/posters/:id',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const admin = req.adminUser!;
      const posterId = Number(req.params.id);
      const existingRows = await db
        .select()
        .from(posters)
        .where(eq(posters.id, posterId));

      if (existingRows.length === 0) {
        return res.status(404).json({ error: 'Poster not found.' });
      }
      const existing = existingRows[0];

      if (!canAccessClass(admin, existing.classCode)) {
        return res.status(403).json({
          error: `Forbidden: You cannot modify posters for class ${existing.classCode}.`,
        });
      }

      const {
        publicationStatus,
        isFeatured,
        title,
        subtitle,
        posterImageUrl,
        participantsSnapshot,
      } = req.body || {};

      const updated = await db
        .update(posters)
        .set({
          publicationStatus: publicationStatus ?? existing.publicationStatus,
          isFeatured:
            typeof isFeatured === 'boolean' ? isFeatured : existing.isFeatured,
          title: title ? String(title).trim() : existing.title,
          subtitle: subtitle ? String(subtitle).trim() : existing.subtitle,
          posterImageUrl: posterImageUrl
            ? String(posterImageUrl)
            : existing.posterImageUrl,
          participantsSnapshot: participantsSnapshot
            ? String(participantsSnapshot)
            : existing.participantsSnapshot,
          updatedAt: new Date(),
        })
        .where(eq(posters.id, posterId))
        .returning();

      await logActivity({
        actorEmail: admin.email,
        actorRole: admin.role,
        action: posterImageUrl ? 'EDIT_POSTER_STUDIO' : 'UPDATE_POSTER_STATUS',
        targetType: 'POSTER',
        targetId: String(posterId),
        classCode: existing.classCode,
        details: posterImageUrl
          ? `Customized and saved poster "${updated[0].title}" in Pro Poster Studio.`
          : `Updated poster "${updated[0].title}" (Status: ${updated[0].publicationStatus}).`,
      });

      return res.json({ poster: updated[0] });
    } catch (error: any) {
      return res
        .status(400)
        .json({ error: error.message || 'Failed to update poster.' });
    }
  }
);

// Studio endpoints for uploading a pre-made poster, saving an edited poster, resetting to auto SVG, and sharing to Feed (Restricted to Super Admin, Teacher, and Class Admin)
app.post(
  '/api/public/upload-poster',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { fileName, base64Data } = req.body || {};
    if (!fileName || !base64Data) {
      return res
        .status(400)
        .json({ error: 'File name and image data are required.' });
    }
    const ext = path.extname(String(fileName)).toLowerCase() || '.png';
    if (!IMAGE_EXTENSIONS.has(ext)) {
      return res.status(400).json({
        error: 'Only image formats (PNG, JPG, JPEG, WEBP, GIF) are allowed for posters.',
      });
    }
    const base64Clean = String(base64Data).includes(',')
      ? String(base64Data).split(',')[1]
      : String(base64Data);
    const buffer = Buffer.from(base64Clean, 'base64');
    if (buffer.byteLength > 15 * 1024 * 1024) {
      return res
        .status(400)
        .json({ error: 'Poster image exceeds 15 MB maximum size.' });
    }
    const safeBase = path
      .basename(String(fileName), ext)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 48);

    const imgbbUrl = await uploadToImgBB(
      base64Clean,
      `${safeBase}_${Date.now()}`
    );
    if (imgbbUrl) {
      return res.status(201).json({
        fileUrl: imgbbUrl,
        hostedOn: 'imgbb.com',
      });
    }

    const finalName = `${safeBase}_${Date.now()}${ext}`;
    const filePath = path.join(uploadsDir, finalName);
    fs.writeFileSync(filePath, buffer);
    return res.status(201).json({
      fileUrl: `/uploads/${finalName}`,
      hostedOn: 'local',
    });
  } catch (error: any) {
    return res
      .status(400)
      .json({ error: error.message || 'Failed to upload poster image.' });
  }
});

app.patch(
  '/api/public/posters/:id',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const admin = req.adminUser!;
      const posterId = Number(req.params.id);

      if (!db && !hasSupabaseRuntimeConfig()) {
        const existing = OFFLINE_POSTERS.find((item) => item.id === posterId);
        if (!existing) {
          return res.status(404).json({ error: 'Poster not found.' });
        }
        if (!canAccessClass(admin, existing.classCode)) {
          return res.status(403).json({
            error: `Forbidden: You do not have permission to edit Class ${existing.classCode} posters.`,
          });
        }

        const { title, subtitle, posterImageUrl, participantsSnapshot, resetToAuto } = req.body || {};
        if (resetToAuto) {
          const regenerated = await regeneratePosterForClassCategory(existing.classCode, existing.categoryName);
          return res.json({ poster: regenerated });
        }

        let finalPosterUrl = posterImageUrl ? String(posterImageUrl) : existing.posterImageUrl;
        if (
          finalPosterUrl.startsWith('data:image/png;base64,') ||
          finalPosterUrl.startsWith('data:image/jpeg;base64,') ||
          finalPosterUrl.startsWith('data:image/webp;base64,')
        ) {
          const base64Clean = finalPosterUrl.split(',')[1];
          const finalName = `ilm_class_${existing.classCode}_poster_${Date.now()}.png`;
          fs.writeFileSync(path.join(uploadsDir, finalName), Buffer.from(base64Clean, 'base64'));
          finalPosterUrl = `/uploads/${finalName}`;
        }

        const updated = upsertOfflinePoster({
          ...existing,
          title: title ? String(title).trim() : existing.title,
          subtitle: subtitle ? String(subtitle).trim() : existing.subtitle,
          posterImageUrl: finalPosterUrl,
          participantsSnapshot: participantsSnapshot ? String(participantsSnapshot) : existing.participantsSnapshot,
          publicationStatus: 'PUBLISHED',
          updatedAt: new Date().toISOString(),
        });

        await logActivity({
          actorEmail: admin.email,
          actorRole: admin.role,
          action: 'SAVE_CUSTOM_OR_EDITED_POSTER',
          targetType: 'POSTER',
          targetId: String(posterId),
          classCode: existing.classCode,
          details: `${admin.name} saved edited/uploaded poster for Class ${existing.classCode}.`,
        });

        return res.json({ poster: updated });
      }

      const existingRows = await db
        .select()
        .from(posters)
        .where(eq(posters.id, posterId));
      if (existingRows.length === 0) {
        return res.status(404).json({ error: 'Poster not found.' });
      }
      const existing = existingRows[0];
      if (!canAccessClass(admin, existing.classCode)) {
        return res.status(403).json({
          error: `Forbidden: You do not have permission to edit Class ${existing.classCode} posters.`,
        });
      }

    const {
      title,
      subtitle,
      posterImageUrl,
      participantsSnapshot,
      resetToAuto,
    } = req.body || {};

    if (resetToAuto) {
      const regenerated = await regeneratePosterForClassCategory(
        existing.classCode,
        existing.categoryName
      );
      return res.json({ poster: regenerated });
    }

    let finalPosterUrl = posterImageUrl
      ? String(posterImageUrl)
      : existing.posterImageUrl;

    if (
      finalPosterUrl.startsWith('data:image/png;base64,') ||
      finalPosterUrl.startsWith('data:image/jpeg;base64,') ||
      finalPosterUrl.startsWith('data:image/webp;base64,')
    ) {
      const base64Clean = finalPosterUrl.split(',')[1];
      const imgbbUrl = await uploadToImgBB(
        base64Clean,
        `ilm_class_${existing.classCode}_poster_${Date.now()}`
      );
      if (imgbbUrl) {
        finalPosterUrl = imgbbUrl;
      } else {
        const finalName = `ilm_class_${existing.classCode}_poster_${Date.now()}.png`;
        fs.writeFileSync(
          path.join(uploadsDir, finalName),
          Buffer.from(base64Clean, 'base64')
        );
        finalPosterUrl = `/uploads/${finalName}`;
      }
    }

    const updated = await db
      .update(posters)
      .set({
        title: title ? String(title).trim() : existing.title,
        subtitle: subtitle ? String(subtitle).trim() : existing.subtitle,
        posterImageUrl: finalPosterUrl,
        participantsSnapshot: participantsSnapshot
          ? String(participantsSnapshot)
          : existing.participantsSnapshot,
        publicationStatus: 'PUBLISHED',
        updatedAt: new Date(),
      })
      .where(eq(posters.id, posterId))
      .returning();

    await logActivity({
      actorEmail: admin.email,
      actorRole: admin.role,
      action: 'SAVE_CUSTOM_OR_EDITED_POSTER',
      targetType: 'POSTER',
      targetId: String(posterId),
      classCode: existing.classCode,
      details: `${admin.name} saved edited/uploaded poster for Class ${existing.classCode}.`,
    });

    return res.json({ poster: updated[0] });
  } catch (error: any) {
    return res
      .status(400)
      .json({ error: error.message || 'Failed to save poster.' });
  }
});

app.post(
  '/api/public/posters/:id/share-to-feed',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const admin = req.adminUser!;
      const posterId = Number(req.params.id);

      if (!db && !hasSupabaseRuntimeConfig()) {
        const poster = OFFLINE_POSTERS.find((item) => item.id === posterId);
        if (!poster) {
          return res.status(404).json({ error: 'Poster not found.' });
        }
        if (!canAccessClass(admin, poster.classCode)) {
          return res.status(403).json({
            error: `Forbidden: You do not have permission to share Class ${poster.classCode} posters to the feed.`,
          });
        }

        const { title, caption, mediaUrl, submittedByName } = req.body || {};
        const inserted = upsertOfflineFeedPost({
          classCode: poster.classCode,
          title: String(title || `Class ${poster.classCode} Official Competition Poster`).trim(),
          caption: String(caption || `Official Class ${poster.classCode} Competition Lineup Poster — Shared from ILM Poster Studio.`).trim(),
          mediaUrl: String(mediaUrl || poster.posterImageUrl).trim(),
          mediaType: 'POSTER',
          status: 'APPROVED',
          submittedByEmail: admin.email,
          submittedByName: String(submittedByName || admin.name || `Class ${poster.classCode} Poster Studio`).trim(),
          reviewedByEmail: admin.email,
          reviewedAt: new Date().toISOString(),
        });

        await logActivity({
          actorEmail: admin.email,
          actorRole: admin.role,
          action: 'SHARE_POSTER_TO_FEED',
          targetType: 'FEED_POST',
          targetId: String(inserted.id),
          classCode: poster.classCode,
          details: `${admin.name} shared Class ${poster.classCode} poster "${inserted.title}" to the public Feed.`,
        });

        return res.status(201).json({ post: inserted });
      }

      const existingRows = await db
        .select()
        .from(posters)
        .where(eq(posters.id, posterId));
      if (existingRows.length === 0) {
        return res.status(404).json({ error: 'Poster not found.' });
      }
      const poster = existingRows[0];
      if (!canAccessClass(admin, poster.classCode)) {
        return res.status(403).json({
          error: `Forbidden: You do not have permission to share Class ${poster.classCode} posters to the feed.`,
        });
      }
      const { title, caption, mediaUrl, submittedByName } = req.body || {};

      let finalMediaUrl = mediaUrl
        ? String(mediaUrl)
        : poster.posterImageUrl;

      if (
        finalMediaUrl.startsWith('data:image/png;base64,') ||
        finalMediaUrl.startsWith('data:image/jpeg;base64,') ||
        finalMediaUrl.startsWith('data:image/webp;base64,')
      ) {
        const base64Clean = finalMediaUrl.split(',')[1];
        const imgbbUrl = await uploadToImgBB(
          base64Clean,
          `ilm_feed_poster_${poster.classCode}_${Date.now()}`
        );
        if (imgbbUrl) {
          finalMediaUrl = imgbbUrl;
        } else {
          const finalName = `ilm_feed_poster_${poster.classCode}_${Date.now()}.png`;
          fs.writeFileSync(
            path.join(uploadsDir, finalName),
            Buffer.from(base64Clean, 'base64')
          );
          finalMediaUrl = `/uploads/${finalName}`;
        }
      }

      const inserted = await db
        .insert(feedPosts)
        .values({
          classCode: poster.classCode,
          title: String(
            title || `Class ${poster.classCode} Official Competition Poster`
          ).trim(),
          caption: String(
            caption ||
              `Official Class ${poster.classCode} Competition Lineup Poster — Shared from ILM Poster Studio.`
          ).trim(),
          mediaUrl: finalMediaUrl,
          mediaType: 'POSTER',
          status: 'APPROVED',
          submittedByEmail: admin.email,
          submittedByName: String(
            submittedByName || admin.name || `Class ${poster.classCode} Poster Studio`
          ).trim(),
          reviewedByEmail: admin.email,
          reviewedAt: new Date(),
        })
        .returning();

      await logActivity({
        actorEmail: admin.email,
        actorRole: admin.role,
        action: 'SHARE_POSTER_TO_FEED',
        targetType: 'FEED_POST',
        targetId: String(inserted[0].id),
        classCode: poster.classCode,
        details: `${admin.name} shared Class ${poster.classCode} poster "${inserted[0].title}" to the public Feed.`,
      });

      return res.status(201).json({ post: inserted[0] });
    } catch (error: any) {
      return res
        .status(400)
        .json({ error: error.message || 'Failed to share poster to feed.' });
    }
  }
);

// ============================================================================
// 6. CLASS FEED & SUPER ADMIN CONTENT MODERATION ENDPOINTS
// ============================================================================
app.post(
  '/api/admin/feed',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const admin = req.adminUser!;
      const { classCode, title, caption, mediaUrl, mediaType } = req.body || {};

      if (!db && !hasSupabaseRuntimeConfig()) {
        const targetClass = admin.role === 'CLASS_ADMIN' ? admin.assignedClass! : String(classCode || '');
        if (admin.role === 'CLASS_ADMIN' && classCode && classCode !== admin.assignedClass) {
          return res.status(403).json({ error: `Forbidden: You can only submit feed posts for your assigned class (${admin.assignedClass}).` });
        }
        if (!isValidClass(targetClass)) {
          return res.status(400).json({ error: 'Valid class (U1–U6) is required for feed posts.' });
        }
        if (!title || !caption || !mediaUrl) {
          return res.status(400).json({ error: 'Title, caption, and photo/poster media are required.' });
        }

        const inserted = upsertOfflineFeedPost({
          classCode: targetClass,
          title: String(title).trim(),
          caption: String(caption).trim(),
          mediaUrl: String(mediaUrl).trim(),
          mediaType: (mediaType || 'PHOTO') as 'PHOTO' | 'POSTER' | 'ANNOUNCEMENT',
          status: 'APPROVED',
          submittedByEmail: admin.email,
          submittedByName: String(admin.name).trim(),
          reviewedByEmail: admin.email,
          reviewedAt: new Date().toISOString(),
        });

        await logActivity({
          actorEmail: admin.email,
          actorRole: admin.role,
          action: 'PUBLISH_FEED_POST',
          targetType: 'FEED_POST',
          targetId: String(inserted.id),
          classCode: targetClass,
          details: `${admin.name} submitted feed post "${inserted.title}" for ${targetClass} (Status: APPROVED).`,
        });

        return res.status(201).json({ post: inserted });
      }

      const targetClass =
        admin.role === 'CLASS_ADMIN' ? admin.assignedClass! : String(classCode || '');

      if (
        admin.role === 'CLASS_ADMIN' &&
        classCode &&
        classCode !== admin.assignedClass
      ) {
        return res.status(403).json({
          error: `Forbidden: You can only submit feed posts for your assigned class (${admin.assignedClass}).`,
        });
      }

      if (!isValidClass(targetClass)) {
        return res
          .status(400)
          .json({ error: 'Valid class (U1–U6) is required for feed posts.' });
      }
      if (!title || !caption || !mediaUrl) {
        return res
          .status(400)
          .json({ error: 'Title, caption, and photo/poster media are required.' });
      }

      // Publish immediately to public Home Page Feed so posts are visible right away
      const initialStatus = 'APPROVED';

      const inserted = await db
        .insert(feedPosts)
        .values({
          classCode: targetClass,
          title: String(title).trim(),
          caption: String(caption).trim(),
          mediaUrl: String(mediaUrl).trim(),
          mediaType: mediaType || 'PHOTO',
          status: initialStatus,
          submittedByEmail: admin.email,
          submittedByName: admin.name,
          reviewedByEmail:
            admin.role === 'SUPER_ADMIN' || admin.role === 'TEACHER'
              ? admin.email
              : null,
          reviewedAt:
            admin.role === 'SUPER_ADMIN' || admin.role === 'TEACHER'
              ? new Date()
              : null,
        })
        .returning();

      await logActivity({
        actorEmail: admin.email,
        actorRole: admin.role,
        action:
          initialStatus === 'APPROVED'
            ? 'PUBLISH_FEED_POST'
            : 'SUBMIT_FEED_POST_FOR_APPROVAL',
        targetType: 'FEED_POST',
        targetId: String(inserted[0].id),
        classCode: targetClass,
        details: `${admin.name} submitted feed post "${inserted[0].title}" for ${targetClass} (Status: ${initialStatus}).`,
      });

      return res.status(201).json({ post: inserted[0] });
    } catch (error: any) {
      return res
        .status(400)
        .json({ error: error.message || 'Failed to submit feed post.' });
    }
  }
);

app.put(
  '/api/admin/feed/:id',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const admin = req.adminUser!;
      const postId = Number(req.params.id);

      if (!db && !hasSupabaseRuntimeConfig()) {
        const existing = OFFLINE_FEED_POSTS.find((item) => item.id === postId);
        if (!existing) {
          return res.status(404).json({ error: 'Feed post not found.' });
        }
        if (!canAccessClass(admin, existing.classCode)) {
          return res.status(403).json({
            error: 'Forbidden: You cannot edit feed submissions from another class.',
          });
        }

        const { title, caption, mediaUrl, mediaType } = req.body || {};
        const nextStatus = admin.role === 'CLASS_ADMIN' ? 'PENDING' : existing.status;
        const updated = upsertOfflineFeedPost({
          id: postId,
          classCode: existing.classCode,
          title: title ? String(title).trim() : existing.title,
          caption: caption ? String(caption).trim() : existing.caption,
          mediaUrl: mediaUrl ? String(mediaUrl).trim() : existing.mediaUrl,
          mediaType: (mediaType || existing.mediaType) as 'PHOTO' | 'POSTER' | 'ANNOUNCEMENT',
          status: nextStatus,
          rejectionReason: admin.role === 'CLASS_ADMIN' ? null : existing.rejectionReason,
          submittedByEmail: existing.submittedByEmail,
          submittedByName: existing.submittedByName,
          reviewedByEmail: admin.role === 'CLASS_ADMIN' ? null : existing.reviewedByEmail,
          reviewedAt: admin.role === 'CLASS_ADMIN' ? null : existing.reviewedAt || null,
        });

        await logActivity({
          actorEmail: admin.email,
          actorRole: admin.role,
          action: 'UPDATE_RESUBMIT_FEED_POST',
          targetType: 'FEED_POST',
          targetId: String(postId),
          classCode: existing.classCode,
          details: `Updated feed post "${updated.title}" (Status: ${nextStatus}).`,
        });

        return res.json({ post: updated });
      }

      const existingRows = await db
        .select()
        .from(feedPosts)
        .where(eq(feedPosts.id, postId));

      if (existingRows.length === 0) {
        return res.status(404).json({ error: 'Feed post not found.' });
      }
      const existing = existingRows[0];

      if (!canAccessClass(admin, existing.classCode)) {
        return res.status(403).json({
          error: 'Forbidden: You cannot edit feed submissions from another class.',
        });
      }

      const { title, caption, mediaUrl, mediaType } = req.body || {};

      // When a Class Admin edits/resubmits a post, it returns to PENDING for Super Admin review
      const nextStatus =
        admin.role === 'CLASS_ADMIN' ? 'PENDING' : existing.status;

      const updated = await db
        .update(feedPosts)
        .set({
          title: title ? String(title).trim() : existing.title,
          caption: caption ? String(caption).trim() : existing.caption,
          mediaUrl: mediaUrl ? String(mediaUrl).trim() : existing.mediaUrl,
          mediaType: mediaType || existing.mediaType,
          status: nextStatus,
          rejectionReason:
            admin.role === 'CLASS_ADMIN' ? null : existing.rejectionReason,
          updatedAt: new Date(),
        })
        .where(eq(feedPosts.id, postId))
        .returning();

      await logActivity({
        actorEmail: admin.email,
        actorRole: admin.role,
        action: 'UPDATE_RESUBMIT_FEED_POST',
        targetType: 'FEED_POST',
        targetId: String(postId),
        classCode: existing.classCode,
        details: `Updated feed post "${updated[0].title}" (Status: ${nextStatus}).`,
      });

      return res.json({ post: updated[0] });
    } catch (error: any) {
      return res
        .status(400)
        .json({ error: error.message || 'Failed to update feed post.' });
    }
  }
);

app.post(
  '/api/admin/feed/:id/moderate',
  requireAuth,
  requireGlobalControl,
  async (req: AuthRequest, res: Response) => {
    try {
      const admin = req.adminUser!;
      const postId = Number(req.params.id);
      const { decision, rejectionReason } = req.body || {};

      if (decision !== 'APPROVED' && decision !== 'REJECTED') {
        return res.status(400).json({
          error: "Moderation decision must be either 'APPROVED' or 'REJECTED'.",
        });
      }

      if (!db && !hasSupabaseRuntimeConfig()) {
        const existing = OFFLINE_FEED_POSTS.find((item) => item.id === postId);
        if (!existing) {
          return res.status(404).json({ error: 'Feed submission not found.' });
        }

        const updated = upsertOfflineFeedPost({
          id: postId,
          classCode: existing.classCode,
          title: existing.title,
          caption: existing.caption,
          mediaUrl: existing.mediaUrl,
          mediaType: existing.mediaType,
          status: decision,
          rejectionReason:
            decision === 'REJECTED'
              ? String(rejectionReason || 'Requires revision before public publication.').trim()
              : null,
          submittedByEmail: existing.submittedByEmail,
          submittedByName: existing.submittedByName,
          reviewedByEmail: admin.email,
          reviewedAt: new Date().toISOString(),
        });

        await logActivity({
          actorEmail: admin.email,
          actorRole: admin.role,
          action: `MODERATE_FEED_${decision}`,
          targetType: 'FEED_POST',
          targetId: String(postId),
          classCode: updated.classCode,
          details: `Super Admin ${decision.toLowerCase()} feed post "${updated.title}" (${updated.classCode}).`,
        });

        return res.json({ post: updated });
      }

      const existingRows = await db
        .select()
        .from(feedPosts)
        .where(eq(feedPosts.id, postId));
      if (existingRows.length === 0) {
        return res.status(404).json({ error: 'Feed submission not found.' });
      }

      const updated = await db
        .update(feedPosts)
        .set({
          status: decision,
          rejectionReason:
            decision === 'REJECTED'
              ? String(rejectionReason || 'Requires revision before public publication.').trim()
              : null,
          reviewedByEmail: admin.email,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(feedPosts.id, postId))
        .returning();

      await logActivity({
        actorEmail: admin.email,
        actorRole: admin.role,
        action: `MODERATE_FEED_${decision}`,
        targetType: 'FEED_POST',
        targetId: String(postId),
        classCode: updated[0].classCode,
        details: `Super Admin ${decision.toLowerCase()} feed post "${updated[0].title}" (${updated[0].classCode}).`,
      });

      return res.json({ post: updated[0] });
    } catch (error: any) {
      return res
        .status(400)
        .json({ error: error.message || 'Moderation operation failed.' });
    }
  }
);

app.delete(
  '/api/admin/feed/:id',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const admin = req.adminUser!;
      const postId = Number(req.params.id);

      if (!db && !hasSupabaseRuntimeConfig()) {
        const existing = OFFLINE_FEED_POSTS.find((item) => item.id === postId);
        if (!existing) {
          return res.status(404).json({ error: 'Feed post not found.' });
        }
        if (!canAccessClass(admin, existing.classCode)) {
          return res.status(403).json({
            error: 'Forbidden: You cannot delete feed posts from another class.',
          });
        }

        const deleted = removeOfflineFeedPost(postId);
        if (!deleted) {
          return res.status(404).json({ error: 'Feed post not found.' });
        }

        await logActivity({
          actorEmail: admin.email,
          actorRole: admin.role,
          action: 'DELETE_FEED_POST',
          targetType: 'FEED_POST',
          targetId: String(postId),
          classCode: existing.classCode,
          details: `Deleted feed post "${existing.title}" from ${existing.classCode}.`,
        });

        return res.json({ deletedId: postId });
      }

      const existingRows = await db
        .select()
        .from(feedPosts)
        .where(eq(feedPosts.id, postId));

      if (existingRows.length === 0) {
        return res.status(404).json({ error: 'Feed post not found.' });
      }
      const existing = existingRows[0];

      if (!canAccessClass(admin, existing.classCode)) {
        return res.status(403).json({
          error: 'Forbidden: You cannot delete feed posts from another class.',
        });
      }

      await db.delete(feedPosts).where(eq(feedPosts.id, postId));

      await logActivity({
        actorEmail: admin.email,
        actorRole: admin.role,
        action: 'DELETE_FEED_POST',
        targetType: 'FEED_POST',
        targetId: String(postId),
        classCode: existing.classCode,
        details: `Deleted feed post "${existing.title}" from ${existing.classCode}.`,
      });

      return res.json({ deletedId: postId });
    } catch (error: any) {
      return res
        .status(400)
        .json({ error: error.message || 'Failed to delete feed post.' });
    }
  }
);

// ============================================================================
// 7. WEEKLY OFFICIAL RESULTS ENDPOINTS (SUPER ADMIN & TEACHER)
// ============================================================================
app.post(
  '/api/admin/results',
  requireAuth,
  requireGlobalControl,
  async (req: AuthRequest, res: Response) => {
    try {
      const admin = req.adminUser!;
      const {
        resultCategory,
        winnerName,
        winnerPhotoUrl,
        winnerClass,
        weekLabel,
        resultDate,
        remarks,
        publicationStatus,
      } = req.body || {};

      if (
        !RESULT_CATEGORIES.includes(resultCategory as 'Best Speaker' | 'Best Naat')
      ) {
        return res.status(400).json({
          error: "Result category must be 'Best Speaker' or 'Best Naat'.",
        });
      }
      if (!isValidClass(String(winnerClass || ''))) {
        return res
          .status(400)
          .json({ error: 'Winner class must be one of U1, U2, U3, U4, U5, or U6.' });
      }
      if (!winnerName || !winnerPhotoUrl || !weekLabel || !resultDate) {
        return res.status(400).json({
          error:
            'Winner name, photograph, week period, and result date are required.',
        });
      }

      if (!db && !hasSupabaseRuntimeConfig()) {
        const inserted = upsertOfflineWeeklyResult({
          resultCategory: String(resultCategory) as 'Best Speaker' | 'Best Naat',
          winnerName: String(winnerName).trim(),
          winnerPhotoUrl: String(winnerPhotoUrl).trim(),
          winnerClass: String(winnerClass),
          weekLabel: String(weekLabel).trim(),
          resultDate: String(resultDate).trim(),
          remarks: remarks ? String(remarks).trim() : null,
          publicationStatus: publicationStatus || 'PUBLISHED',
          publishedByEmail: admin.email,
        });

        await logActivity({
          actorEmail: admin.email,
          actorRole: admin.role,
          action: 'PUBLISH_WEEKLY_RESULT',
          targetType: 'WEEKLY_RESULT',
          targetId: String(inserted.id),
          classCode: String(winnerClass),
          details: `Published official ${resultCategory} result for ${weekLabel}: ${winnerName} (${winnerClass}).`,
        });

        return res.status(201).json({ result: inserted });
      }

      const sqlDb = requireSqlDbForWrite('publishing a weekly result');
      const inserted = await sqlDb
        .insert(weeklyResults)
        .values({
          resultCategory: String(resultCategory),
          winnerName: String(winnerName).trim(),
          winnerPhotoUrl: String(winnerPhotoUrl).trim(),
          winnerClass: String(winnerClass),
          weekLabel: String(weekLabel).trim(),
          resultDate: String(resultDate).trim(),
          remarks: remarks ? String(remarks).trim() : null,
          publicationStatus: publicationStatus || 'PUBLISHED',
          publishedByEmail: admin.email,
        })
        .returning();

      await logActivity({
        actorEmail: admin.email,
        actorRole: admin.role,
        action: 'PUBLISH_WEEKLY_RESULT',
        targetType: 'WEEKLY_RESULT',
        targetId: String(inserted[0].id),
        classCode: String(winnerClass),
        details: `Published official ${resultCategory} result for ${weekLabel}: ${winnerName} (${winnerClass}).`,
      });

      return res.status(201).json({ result: inserted[0] });
    } catch (error: any) {
      return res
        .status(400)
        .json({ error: error.message || 'Failed to publish weekly result.' });
    }
  }
);

app.put(
  '/api/admin/results/:id',
  requireAuth,
  requireGlobalControl,
  async (req: AuthRequest, res: Response) => {
    try {
      const admin = req.adminUser!;
      const resultId = Number(req.params.id);
      const existingRows = await db
        .select()
        .from(weeklyResults)
        .where(eq(weeklyResults.id, resultId));
      if (existingRows.length === 0) {
        return res.status(404).json({ error: 'Weekly result record not found.' });
      }
      const existing = existingRows[0];

      const {
        resultCategory,
        winnerName,
        winnerPhotoUrl,
        winnerClass,
        weekLabel,
        resultDate,
        remarks,
        publicationStatus,
      } = req.body || {};

      if (winnerClass && !isValidClass(String(winnerClass))) {
        return res.status(400).json({ error: 'Winner class must be U1–U6.' });
      }

      if (!db && !hasSupabaseRuntimeConfig()) {
        const current = OFFLINE_WEEKLY_RESULTS.find((item) => item.id === resultId);
        if (!current) {
          return res.status(404).json({ error: 'Weekly result record not found.' });
        }

        const updated = upsertOfflineWeeklyResult({
          id: resultId,
          resultCategory: (resultCategory ?? current.resultCategory) as 'Best Speaker' | 'Best Naat',
          winnerName: winnerName ? String(winnerName).trim() : current.winnerName,
          winnerPhotoUrl: winnerPhotoUrl ? String(winnerPhotoUrl).trim() : current.winnerPhotoUrl,
          winnerClass: winnerClass ?? current.winnerClass,
          weekLabel: weekLabel ? String(weekLabel).trim() : current.weekLabel,
          resultDate: resultDate ? String(resultDate).trim() : current.resultDate,
          remarks: remarks !== undefined ? remarks : current.remarks,
          publicationStatus: publicationStatus ?? current.publicationStatus,
        });

        await logActivity({
          actorEmail: admin.email,
          actorRole: admin.role,
          action: 'UPDATE_WEEKLY_RESULT',
          targetType: 'WEEKLY_RESULT',
          targetId: String(resultId),
          classCode: updated.winnerClass,
          details: `Updated official weekly result #${resultId} (${updated.resultCategory} — ${updated.winnerName}).`,
        });

        return res.json({ result: updated });
      }

      const updated = await db
        .update(weeklyResults)
        .set({
          resultCategory: resultCategory ?? existing.resultCategory,
          winnerName: winnerName ? String(winnerName).trim() : existing.winnerName,
          winnerPhotoUrl: winnerPhotoUrl
            ? String(winnerPhotoUrl).trim()
            : existing.winnerPhotoUrl,
          winnerClass: winnerClass ?? existing.winnerClass,
          weekLabel: weekLabel ? String(weekLabel).trim() : existing.weekLabel,
          resultDate: resultDate ? String(resultDate).trim() : existing.resultDate,
          remarks: remarks !== undefined ? remarks : existing.remarks,
          publicationStatus: publicationStatus ?? existing.publicationStatus,
          updatedAt: new Date(),
        })
        .where(eq(weeklyResults.id, resultId))
        .returning();

      await logActivity({
        actorEmail: admin.email,
        actorRole: admin.role,
        action: 'UPDATE_WEEKLY_RESULT',
        targetType: 'WEEKLY_RESULT',
        targetId: String(resultId),
        classCode: updated[0].winnerClass,
        details: `Updated official weekly result #${resultId} (${updated[0].resultCategory} — ${updated[0].winnerName}).`,
      });

      return res.json({ result: updated[0] });
    } catch (error: any) {
      return res
        .status(400)
        .json({ error: error.message || 'Failed to update weekly result.' });
    }
  }
);

app.delete(
  '/api/admin/results/:id',
  requireAuth,
  requireGlobalControl,
  async (req: AuthRequest, res: Response) => {
    try {
      const admin = req.adminUser!;
      const resultId = Number(req.params.id);

      if (!db && !hasSupabaseRuntimeConfig()) {
        const deleted = removeOfflineWeeklyResult(resultId);
        if (!deleted) {
          return res.status(404).json({ error: 'Weekly result record not found.' });
        }

        await logActivity({
          actorEmail: admin.email,
          actorRole: admin.role,
          action: 'DELETE_WEEKLY_RESULT',
          targetType: 'WEEKLY_RESULT',
          targetId: String(resultId),
          details: `Removed weekly result record #${resultId}.`,
        });

        return res.json({ deletedId: resultId });
      }

      await db.delete(weeklyResults).where(eq(weeklyResults.id, resultId));

      await logActivity({
        actorEmail: admin.email,
        actorRole: admin.role,
        action: 'DELETE_WEEKLY_RESULT',
        targetType: 'WEEKLY_RESULT',
        targetId: String(resultId),
        details: `Removed weekly result record #${resultId}.`,
      });

      return res.json({ deletedId: resultId });
    } catch (error: any) {
      return res
        .status(400)
        .json({ error: error.message || 'Failed to delete weekly result.' });
    }
  }
);

// ============================================================================
// 8. DIGITAL LIBRARY ENDPOINTS (COMMON + U1..U6 CLASS LIBRARIES)
// ============================================================================
app.post(
  '/api/admin/library',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const admin = req.adminUser!;
      const {
        title,
        description,
        author,
        category,
        libraryScope,
        fileUrl,
        fileType,
        fileSize,
        contentPreview,
        publicationStatus,
      } = req.body || {};

      if (
        !LIBRARY_CATEGORIES.includes(
          category as (typeof LIBRARY_CATEGORIES)[number]
        )
      ) {
        return res.status(400).json({
          error: `Invalid library category. Allowed categories: ${LIBRARY_CATEGORIES.join(
            ', '
          )}`,
        });
      }

      const targetScope =
        admin.role === 'CLASS_ADMIN'
          ? admin.assignedClass!
          : String(libraryScope || 'COMMON');

      if (
        admin.role === 'CLASS_ADMIN' &&
        libraryScope &&
        libraryScope !== admin.assignedClass
      ) {
        return res.status(403).json({
          error: `Forbidden: Class Admin for ${admin.assignedClass} can only upload to the ${admin.assignedClass} Class Library.`,
        });
      }

      if (targetScope !== 'COMMON' && !isValidClass(targetScope)) {
        return res.status(400).json({
          error: 'Library scope must be COMMON or one of U1–U6.',
        });
      }

      if (!title || !description || !fileUrl) {
        return res.status(400).json({
          error: 'Resource title, description, and file/URL are required.',
        });
      }

      if (!db && !hasSupabaseRuntimeConfig()) {
        const inserted = upsertOfflineLibraryResource({
          title: String(title).trim(),
          description: String(description).trim(),
          author: String(author || admin.name).trim(),
          category: String(category),
          libraryScope: targetScope,
          fileUrl: String(fileUrl).trim(),
          fileType: String(fileType || 'PDF').toUpperCase(),
          fileSize: String(fileSize || '1.0 MB'),
          contentPreview: contentPreview ? String(contentPreview) : null,
          publicationStatus: publicationStatus || 'PUBLISHED',
          uploadedByEmail: admin.email,
        });

        await logActivity({
          actorEmail: admin.email,
          actorRole: admin.role,
          action: 'ADD_LIBRARY_RESOURCE',
          targetType: 'LIBRARY_RESOURCE',
          targetId: String(inserted.id),
          classCode: targetScope === 'COMMON' ? undefined : targetScope,
          details: `Added ${category} resource "${inserted.title}" to ${targetScope} library.`,
        });

        return res.status(201).json({ resource: inserted });
      }

      const inserted = await db
        .insert(libraryResources)
        .values({
          title: String(title).trim(),
          description: String(description).trim(),
          author: String(author || admin.name).trim(),
          category: String(category),
          libraryScope: targetScope,
          fileUrl: String(fileUrl).trim(),
          fileType: String(fileType || 'PDF').toUpperCase(),
          fileSize: String(fileSize || '1.0 MB'),
          contentPreview: contentPreview ? String(contentPreview) : null,
          publicationStatus: publicationStatus || 'PUBLISHED',
          uploadedByEmail: admin.email,
        })
        .returning();

      await logActivity({
        actorEmail: admin.email,
        actorRole: admin.role,
        action: 'ADD_LIBRARY_RESOURCE',
        targetType: 'LIBRARY_RESOURCE',
        targetId: String(inserted[0].id),
        classCode: targetScope === 'COMMON' ? undefined : targetScope,
        details: `Added ${category} resource "${inserted[0].title}" to ${targetScope} library.`,
      });

      return res.status(201).json({ resource: inserted[0] });
    } catch (error: any) {
      return res
        .status(400)
        .json({ error: error.message || 'Failed to add library resource.' });
    }
  }
);

app.patch(
  '/api/admin/library/:id',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const admin = req.adminUser!;
      const resourceId = Number(req.params.id);
      const { publicationStatus } = req.body || {};

      if (!db && !hasSupabaseRuntimeConfig()) {
        const current = createFallbackBootstrapData().libraryResources.find(
          (item) => item.id === resourceId
        );
        const activeResource = current || {
          id: resourceId,
          title: `Library Resource #${resourceId}`,
          description: '',
          author: admin.name,
          category: 'Books',
          libraryScope: admin.role === 'CLASS_ADMIN' ? admin.assignedClass || 'U1' : 'COMMON',
          fileUrl: '#',
          fileType: 'PDF',
          fileSize: '1.0 MB',
          contentPreview: null,
          publicationStatus: 'PUBLISHED',
          uploadedByEmail: admin.email,
          createdAt: new Date().toISOString(),
        };

        const nextStatus = publicationStatus
          ? String(publicationStatus).trim().toUpperCase()
          : activeResource.publicationStatus || 'PUBLISHED';

        const updated = upsertOfflineLibraryResource({
          id: resourceId,
          title: activeResource.title,
          description: activeResource.description,
          author: activeResource.author,
          category: activeResource.category,
          libraryScope: activeResource.libraryScope,
          fileUrl: activeResource.fileUrl,
          fileType: activeResource.fileType,
          fileSize: activeResource.fileSize,
          contentPreview: activeResource.contentPreview,
          publicationStatus: nextStatus,
          uploadedByEmail: activeResource.uploadedByEmail,
        });

        await logActivity({
          actorEmail: admin.email,
          actorRole: admin.role,
          action: 'UPDATE_LIBRARY_VISIBILITY',
          targetType: 'LIBRARY_RESOURCE',
          targetId: String(resourceId),
          classCode: activeResource.libraryScope === 'COMMON' ? undefined : activeResource.libraryScope,
          details: `Updated library resource "${updated.title}" visibility to ${updated.publicationStatus}.`,
        });

        return res.json({ resource: updated });
      }

      const existingRows = await db
        .select()
        .from(libraryResources)
        .where(eq(libraryResources.id, resourceId));

      if (existingRows.length === 0) {
        return res.status(404).json({ error: 'Library resource not found.' });
      }

      const existing = existingRows[0];
      if (
        admin.role === 'CLASS_ADMIN' &&
        existing.libraryScope !== admin.assignedClass
      ) {
        return res.status(403).json({
          error:
            'Forbidden: Class Admins can only manage resources in their own assigned class library.',
        });
      }

      const nextStatus =
        publicationStatus && String(publicationStatus).trim().toUpperCase();
      if (
        nextStatus &&
        !['PUBLISHED', 'HIDDEN', 'PRIVATE', 'DRAFT'].includes(nextStatus)
      ) {
        return res.status(400).json({
          error: 'Invalid library visibility status. Allowed values: PUBLISHED, HIDDEN.',
        });
      }

      const normalizedStatus = nextStatus || existing.publicationStatus || 'PUBLISHED';
      const updated = await db
        .update(libraryResources)
        .set({
          publicationStatus: normalizedStatus,
          updatedAt: new Date(),
        })
        .where(eq(libraryResources.id, resourceId))
        .returning();

      await logActivity({
        actorEmail: admin.email,
        actorRole: admin.role,
        action: 'UPDATE_LIBRARY_VISIBILITY',
        targetType: 'LIBRARY_RESOURCE',
        targetId: String(resourceId),
        classCode: existing.libraryScope === 'COMMON' ? undefined : existing.libraryScope,
        details: `Updated library resource "${existing.title}" visibility to ${updated[0].publicationStatus}.`,
      });

      return res.json({ resource: updated[0] });
    } catch (error: any) {
      return res
        .status(400)
        .json({ error: error.message || 'Failed to update library resource visibility.' });
    }
  }
);

app.delete(
  '/api/admin/library/:id',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const admin = req.adminUser!;
      const resourceId = Number(req.params.id);

      if (!db && !hasSupabaseRuntimeConfig()) {
        const existing = createFallbackBootstrapData().libraryResources.find(
          (item) => item.id === resourceId
        );
        if (!existing) {
          return res.status(404).json({ error: 'Library resource not found.' });
        }

        const removed = removeOfflineLibraryResource(resourceId);
        if (!removed) {
          return res.status(404).json({ error: 'Library resource not found.' });
        }

        await logActivity({
          actorEmail: admin.email,
          actorRole: admin.role,
          action: 'DELETE_LIBRARY_RESOURCE',
          targetType: 'LIBRARY_RESOURCE',
          targetId: String(resourceId),
          classCode: existing.libraryScope === 'COMMON' ? undefined : existing.libraryScope,
          details: `Removed library resource "${existing.title}" from ${existing.libraryScope}.`,
        });

        return res.json({ deletedId: resourceId });
      }

      const existingRows = await db
        .select()
        .from(libraryResources)
        .where(eq(libraryResources.id, resourceId));
      if (existingRows.length === 0) {
        return res.status(404).json({ error: 'Library resource not found.' });
      }
      const existing = existingRows[0];

      if (
        admin.role === 'CLASS_ADMIN' &&
        existing.libraryScope !== admin.assignedClass
      ) {
        return res.status(403).json({
          error:
            'Forbidden: Class Admins can only manage resources in their own assigned class library.',
        });
      }

      await db
        .delete(libraryResources)
        .where(eq(libraryResources.id, resourceId));

      await logActivity({
        actorEmail: admin.email,
        actorRole: admin.role,
        action: 'DELETE_LIBRARY_RESOURCE',
        targetType: 'LIBRARY_RESOURCE',
        targetId: String(resourceId),
        classCode:
          existing.libraryScope === 'COMMON' ? undefined : existing.libraryScope,
        details: `Removed library resource "${existing.title}" from ${existing.libraryScope}.`,
      });

      return res.json({ deletedId: resourceId });
    } catch (error: any) {
      return res
        .status(400)
        .json({ error: error.message || 'Failed to delete library resource.' });
    }
  }
);

// ============================================================================
// 9. USERS / ADMIN MANAGEMENT ENDPOINTS (SUPER ADMIN ONLY, 1-ADMIN-PER-CLASS)
// ============================================================================
app.post(
  '/api/admin/users',
  requireAuth,
  requireSuperAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const superAdmin = req.adminUser!;
      const {
        email,
        name,
        role,
        assignedClass,
        password,
        replaceExistingClassAdmin,
      } = req.body || {};

      if (!email || !name || !role) {
        return res
          .status(400)
          .json({ error: 'Administrator name, email, and role are required.' });
      }
      if (
        role !== 'SUPER_ADMIN' &&
        role !== 'TEACHER' &&
        role !== 'CLASS_ADMIN'
      ) {
        return res.status(400).json({
          error: "Role must be 'SUPER_ADMIN', 'TEACHER', or 'CLASS_ADMIN'.",
        });
      }

      const normalizedEmail = String(email).trim().toLowerCase();
      ensureSqlDatabaseReady(res, 'Administrator creation');
      let targetClass: string | null = null;

      if (role === 'CLASS_ADMIN') {
        if (!assignedClass || !isValidClass(String(assignedClass))) {
          return res.status(400).json({
            error:
              'Class Admin must be assigned to exactly one valid class (U1–U6).',
          });
        }
        targetClass = String(assignedClass);
      }

      if (!isSqlConfigured() && !hasSupabaseRuntimeConfig()) {
        const existingEmail = getOfflineAdminUser(normalizedEmail);
        if (existingEmail) {
          throw new Error(
            `An administrator with email ${normalizedEmail} already exists.`
          );
        }

        if (role === 'CLASS_ADMIN' && targetClass) {
          const activeForClass = OFFLINE_ADMIN_USERS.filter(
            (user) =>
              user.role === 'CLASS_ADMIN' &&
              user.assignedClass === targetClass &&
              user.status === 'ACTIVE'
          );

          if (activeForClass.length > 0) {
            if (!replaceExistingClassAdmin) {
              throw new Error(
                `Class ${targetClass} already has an active Class Admin (${activeForClass[0].email}). Only one active Class Admin is allowed per class. Check "Replace existing Class Admin" to reassign.`
              );
            }
            for (const prev of activeForClass) {
              prev.status = 'DEACTIVATED';
            }
          }
        }

        const plainPw = String(password || 'IlmAdmin#2026').trim();
        const createdUser = upsertOfflineAdminUser({
          email: normalizedEmail,
          name: String(name).trim(),
          role,
          assignedClass: targetClass,
          status: 'ACTIVE',
          passwordPlain: plainPw,
        });

        await logActivity({
          actorEmail: superAdmin.email,
          actorRole: superAdmin.role,
          action: 'CREATE_ADMIN_USER',
          targetType: 'USER',
          targetId: String(createdUser.id),
          classCode: targetClass || undefined,
          details: `Created administrator ${createdUser.name} (${createdUser.email}) with role ${createdUser.role}${
            targetClass ? ` assigned to ${targetClass}` : ''
          }.`,
        });

        return res.status(201).json({
          user: {
            id: createdUser.id,
            uid: createdUser.uid,
            email: createdUser.email,
            name: createdUser.name,
            role: createdUser.role,
            assignedClass: createdUser.assignedClass,
            status: createdUser.status,
            passwordPlain: createdUser.passwordPlain,
            createdAt: new Date(),
          },
        });
      }

      if (!isSqlConfigured() && hasSupabaseRuntimeConfig()) {
        const existingEmail = await getSupabaseUserByEmail(normalizedEmail);
        if (existingEmail) {
          throw new Error(
            `An administrator with email ${normalizedEmail} already exists.`
          );
        }

        if (role === 'CLASS_ADMIN' && targetClass) {
          const activeForClass = await getSupabaseUsersByClass(targetClass);
          if (activeForClass.length > 0) {
            if (!replaceExistingClassAdmin) {
              throw new Error(
                `Class ${targetClass} already has an active Class Admin (${activeForClass[0].email}). Only one active Class Admin is allowed per class. Check "Replace existing Class Admin" to reassign.`
              );
            }
            for (const prev of activeForClass) {
              const client = getSupabaseClient();
              if (client) {
                await client
                  .from('users')
                  .update({ status: 'DEACTIVATED', updated_at: new Date().toISOString() })
                  .eq('id', prev.id);
              }
            }
          }
        }

        const plainPw = String(password || 'IlmAdmin#2026').trim();
        const createdUser = await createSupabaseAdminUser({
          uid: `supabase-${crypto.randomUUID()}`,
          email: normalizedEmail,
          name: String(name).trim(),
          role,
          assignedClass: targetClass,
          status: 'ACTIVE',
          passwordHash: hashPassword(plainPw),
          passwordPlain: plainPw,
        });

        if (!createdUser) {
          throw new Error('Failed to create administrator in Supabase.');
        }

        await logActivity({
          actorEmail: superAdmin.email,
          actorRole: superAdmin.role,
          action: 'CREATE_ADMIN_USER',
          targetType: 'USER',
          targetId: String(createdUser.id),
          classCode: targetClass || undefined,
          details: `Created administrator ${createdUser.name} (${createdUser.email}) with role ${createdUser.role}${
            targetClass ? ` assigned to ${targetClass}` : ''
          }.`,
        });

        return res.status(201).json({
          user: {
            id: createdUser.id,
            uid: createdUser.uid,
            email: createdUser.email,
            name: createdUser.name,
            role: createdUser.role,
            assignedClass: createdUser.assignedClass,
            status: createdUser.status,
            passwordPlain: createdUser.passwordPlain,
            createdAt: createdUser.createdAt,
          },
        });
      }

      const createdUser = await db.transaction(async (tx) => {
        const existingEmail = await tx
          .select()
          .from(users)
          .where(eq(users.email, normalizedEmail));
        if (existingEmail.length > 0) {
          throw new Error(
            `An administrator with email ${normalizedEmail} already exists.`
          );
        }

        if (role === 'CLASS_ADMIN' && targetClass) {
          const activeForClass = await tx
            .select()
            .from(users)
            .where(
              and(
                eq(users.role, 'CLASS_ADMIN'),
                eq(users.assignedClass, targetClass),
                eq(users.status, 'ACTIVE')
              )
            );

          if (activeForClass.length > 0) {
            if (!replaceExistingClassAdmin) {
              throw new Error(
                `Class ${targetClass} already has an active Class Admin (${activeForClass[0].email}). Only one active Class Admin is allowed per class. Check "Replace existing Class Admin" to reassign.`
              );
            }
            // Deactivate previous Class Admin for this class to preserve the strict 1-active-Class-Admin-per-class invariant
            for (const prev of activeForClass) {
              await tx
                .update(users)
                .set({ status: 'DEACTIVATED', updatedAt: new Date() })
                .where(eq(users.id, prev.id));
            }
          }

          await tx
            .update(classes)
            .set({ adminEmail: normalizedEmail, updatedAt: new Date() })
            .where(eq(classes.code, targetClass));
        }

        const plainPw = String(password || 'IlmAdmin#2026').trim();
        const pwHash = hashPassword(plainPw);
        const inserted = await tx
          .insert(users)
          .values({
            uid: `provisioned-${crypto.randomUUID()}`,
            email: normalizedEmail,
            name: String(name).trim(),
            role,
            assignedClass: targetClass,
            status: 'ACTIVE',
            passwordHash: pwHash,
            passwordPlain: plainPw,
          })
          .returning();

        return inserted[0];
      });

      await logActivity({
        actorEmail: superAdmin.email,
        actorRole: superAdmin.role,
        action: 'CREATE_ADMIN_USER',
        targetType: 'USER',
        targetId: String(createdUser.id),
        classCode: targetClass || undefined,
        details: `Created administrator ${createdUser.name} (${createdUser.email}) with role ${createdUser.role}${
          targetClass ? ` assigned to ${targetClass}` : ''
        }.`,
      });

      return res.status(201).json({
        user: {
          id: createdUser.id,
          uid: createdUser.uid,
          email: createdUser.email,
          name: createdUser.name,
          role: createdUser.role,
          assignedClass: createdUser.assignedClass,
          status: createdUser.status,
          passwordPlain: createdUser.passwordPlain,
          createdAt: createdUser.createdAt,
        },
      });
    } catch (error: any) {
      return res
        .status(400)
        .json({ error: error.message || 'Failed to create administrator.' });
    }
  }
);

app.patch(
  '/api/admin/users/:id',
  requireAuth,
  requireSuperAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const superAdmin = req.adminUser!;
      const targetUserId = Number(req.params.id);
      const {
        email,
        name,
        role,
        assignedClass,
        status,
        newPassword,
        replaceExistingClassAdmin,
      } = req.body || {};

      if (!isSqlConfigured() && !hasSupabaseRuntimeConfig()) {
        const existing = OFFLINE_ADMIN_USERS.find((user) => user.id === targetUserId);
        if (!existing) {
          return res.status(404).json({ error: 'Administrator account not found.' });
        }

        const nextEmail = email ? String(email).trim().toLowerCase() : existing.email;
        const nextRole = role ?? existing.role;
        const nextStatus = status ?? existing.status;
        const nextClass =
          nextRole === 'SUPER_ADMIN' || nextRole === 'TEACHER'
            ? null
            : assignedClass !== undefined
            ? assignedClass
            : existing.assignedClass;

        if (nextRole === 'CLASS_ADMIN' && (!nextClass || !isValidClass(nextClass))) {
          return res.status(400).json({
            error: 'Class Admin must be assigned to a valid class (U1–U6).',
          });
        }

        if (nextRole === 'CLASS_ADMIN' && nextStatus === 'ACTIVE' && nextClass) {
          const conflicting = OFFLINE_ADMIN_USERS.filter(
            (user) =>
              user.role === 'CLASS_ADMIN' &&
              user.assignedClass === nextClass &&
              user.status === 'ACTIVE' &&
              user.id !== existing.id
          );

          if (conflicting.length > 0) {
            if (!replaceExistingClassAdmin) {
              throw new Error(
                `Class ${nextClass} already has an active Class Admin (${conflicting[0].email}). Check "Replace existing Class Admin" to reassign.`
              );
            }
            for (const user of conflicting) {
              user.status = 'DEACTIVATED';
            }
          }
        }

        const updatedUser = {
          ...existing,
          email: nextEmail,
          name: name ? String(name).trim() : existing.name,
          role: nextRole,
          assignedClass: nextClass,
          status: nextStatus,
        };

        if (newPassword && String(newPassword).trim().length >= 4) {
          updatedUser.passwordPlain = String(newPassword).trim();
        }

        const index = OFFLINE_ADMIN_USERS.findIndex((user) => user.id === targetUserId);
        OFFLINE_ADMIN_USERS[index] = updatedUser;

        await logActivity({
          actorEmail: superAdmin.email,
          actorRole: superAdmin.role,
          action: 'UPDATE_ADMIN_USER',
          targetType: 'USER',
          targetId: String(updatedUser.id),
          classCode: updatedUser.assignedClass || undefined,
          details: `Updated administrator ${updatedUser.email}: role=${updatedUser.role}, class=${updatedUser.assignedClass || 'Global'}, status=${updatedUser.status}.`,
        });

        return res.json({
          user: {
            id: updatedUser.id,
            uid: updatedUser.uid,
            email: updatedUser.email,
            name: updatedUser.name,
            role: updatedUser.role,
            assignedClass: updatedUser.assignedClass,
            status: updatedUser.status,
            passwordPlain: updatedUser.passwordPlain,
            updatedAt: new Date(),
          },
        });
      }

      if (!isSqlConfigured() && hasSupabaseRuntimeConfig()) {
        const client = getSupabaseClient();
        if (!client) {
          return res.status(503).json({ error: 'Supabase is not configured.' });
        }

        const { data: existing, error: existingError } = await client
          .from('users')
          .select('*')
          .eq('id', targetUserId)
          .maybeSingle();

        if (existingError || !existing) {
          return res.status(404).json({ error: 'Administrator account not found.' });
        }

        const nextEmail = email ? String(email).trim().toLowerCase() : existing.email;
        const nextRole = role ?? existing.role;
        const nextStatus = status ?? existing.status;
        const nextClass =
          nextRole === 'SUPER_ADMIN' || nextRole === 'TEACHER'
            ? null
            : assignedClass !== undefined
            ? assignedClass
            : existing.assigned_class;

        const updatePayload: Record<string, any> = {
          email: nextEmail,
          name: name ? String(name).trim() : existing.name,
          role: nextRole,
          assigned_class: nextClass,
          status: nextStatus,
          updated_at: new Date().toISOString(),
        };

        if (newPassword && String(newPassword).trim().length >= 4) {
          const cleanPw = String(newPassword).trim();
          updatePayload.password_hash = hashPassword(cleanPw);
          updatePayload.password_plain = cleanPw;
        }

        const { data: updated, error: updateError } = await client
          .from('users')
          .update(updatePayload)
          .eq('id', targetUserId)
          .select()
          .single();

        if (updateError || !updated) {
          throw new Error(updateError?.message || 'Failed to update administrator.');
        }

        await logActivity({
          actorEmail: superAdmin.email,
          actorRole: superAdmin.role,
          action: 'UPDATE_ADMIN_USER',
          targetType: 'USER',
          targetId: String(updated.id),
          classCode: updated.assigned_class || undefined,
          details: `Updated administrator ${updated.email}: role=${updated.role}, class=${
            updated.assigned_class || 'Global'
          }, status=${updated.status}.`,
        });

        return res.json({
          user: {
            id: updated.id,
            uid: updated.uid,
            email: updated.email,
            name: updated.name,
            role: updated.role,
            assignedClass: updated.assigned_class,
            status: updated.status,
            passwordPlain: updated.password_plain,
            updatedAt: updated.updated_at,
          },
        });
      }

      const existingRows = await db
        .select()
        .from(users)
        .where(eq(users.id, targetUserId));
      if (existingRows.length === 0) {
        return res.status(404).json({ error: 'Administrator account not found.' });
      }
      const existing = existingRows[0];

      const nextEmail = email
        ? String(email).trim().toLowerCase()
        : existing.email;
      const nextRole = role ?? existing.role;
      const nextStatus = status ?? existing.status;
      const nextClass =
        nextRole === 'SUPER_ADMIN' || nextRole === 'TEACHER'
          ? null
          : assignedClass !== undefined
          ? assignedClass
          : existing.assignedClass;

      if (nextRole === 'CLASS_ADMIN' && (!nextClass || !isValidClass(nextClass))) {
        return res.status(400).json({
          error: 'Class Admin must be assigned to a valid class (U1–U6).',
        });
      }

      const updatedUser = await db.transaction(async (tx) => {
        if (nextEmail !== existing.email) {
          const emailCheck = await tx
            .select()
            .from(users)
            .where(eq(users.email, nextEmail));
          if (emailCheck.some((u) => u.id !== existing.id)) {
            throw new Error(`Email ${nextEmail} is already in use by another user.`);
          }
        }

        if (
          nextRole === 'CLASS_ADMIN' &&
          nextStatus === 'ACTIVE' &&
          nextClass
        ) {
          const conflicting = await tx
            .select()
            .from(users)
            .where(
              and(
                eq(users.role, 'CLASS_ADMIN'),
                eq(users.assignedClass, nextClass),
                eq(users.status, 'ACTIVE')
              )
            );
          const others = conflicting.filter((u) => u.id !== existing.id);
          if (others.length > 0) {
            if (!replaceExistingClassAdmin) {
              throw new Error(
                `Class ${nextClass} already has an active Class Admin (${others[0].email}). Check "Replace existing Class Admin" to reassign.`
              );
            }
            for (const o of others) {
              await tx
                .update(users)
                .set({ status: 'DEACTIVATED', updatedAt: new Date() })
                .where(eq(users.id, o.id));
            }
          }

          await tx
            .update(classes)
            .set({ adminEmail: nextEmail, updatedAt: new Date() })
            .where(eq(classes.code, nextClass));
        }

        const updatePayload: Record<string, any> = {
          email: nextEmail,
          name: name ? String(name).trim() : existing.name,
          role: nextRole,
          assignedClass: nextClass,
          status: nextStatus,
          updatedAt: new Date(),
        };

        if (newPassword && String(newPassword).trim().length >= 4) {
          const cleanPw = String(newPassword).trim();
          updatePayload.passwordHash = hashPassword(cleanPw);
          updatePayload.passwordPlain = cleanPw;
        }

        const resRows = await tx
          .update(users)
          .set(updatePayload)
          .where(eq(users.id, existing.id))
          .returning();

        return resRows[0];
      });

      await logActivity({
        actorEmail: superAdmin.email,
        actorRole: superAdmin.role,
        action: 'UPDATE_ADMIN_USER',
        targetType: 'USER',
        targetId: String(updatedUser.id),
        classCode: updatedUser.assignedClass || undefined,
        details: `Updated administrator ${updatedUser.email}: role=${updatedUser.role}, class=${
          updatedUser.assignedClass || 'Global'
        }, status=${updatedUser.status}.`,
      });

      return res.json({
        user: {
          id: updatedUser.id,
          uid: updatedUser.uid,
          email: updatedUser.email,
          name: updatedUser.name,
          role: updatedUser.role,
          assignedClass: updatedUser.assignedClass,
          status: updatedUser.status,
          passwordPlain: updatedUser.passwordPlain,
          updatedAt: updatedUser.updatedAt,
        },
      });
    } catch (error: any) {
      return res
        .status(400)
        .json({ error: error.message || 'Failed to update administrator.' });
    }
  }
);

app.delete(
  '/api/admin/users/:id',
  requireAuth,
  requireSuperAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const superAdmin = req.adminUser!;
      const targetUserId = Number(req.params.id);

      if (!isSqlConfigured() && !hasSupabaseRuntimeConfig()) {
        const index = OFFLINE_ADMIN_USERS.findIndex((user) => user.id === targetUserId);
        if (index < 0) {
          return res.status(404).json({ error: 'User account not found.' });
        }

        try {
          validateAdminDelete(OFFLINE_ADMIN_USERS, targetUserId, {
            currentUserId: superAdmin.id,
            currentUserRole: superAdmin.role,
          });
        } catch (error: any) {
          return res.status(400).json({ error: error.message || 'Delete blocked.' });
        }

        const removedUser = OFFLINE_ADMIN_USERS.splice(index, 1)[0];
        await logActivity({
          actorEmail: superAdmin.email,
          actorRole: superAdmin.role,
          action: 'DELETE_ADMIN_USER',
          targetType: 'USER',
          targetId: String(removedUser.id),
          classCode: removedUser.assignedClass || undefined,
          details: `Deleted administrator ${removedUser.email} (${removedUser.role}).`,
        });

        return res.json({ message: `Deleted administrator ${removedUser.email}.` });
      }

      if (!isSqlConfigured() && hasSupabaseRuntimeConfig()) {
        const client = getSupabaseClient();
        if (!client) {
          return res.status(503).json({ error: 'Supabase is not configured.' });
        }

        const { data: existing, error: existingError } = await client
          .from('users')
          .select('*')
          .eq('id', targetUserId)
          .maybeSingle();

        if (existingError || !existing) {
          return res.status(404).json({ error: 'User account not found.' });
        }

        const allUsers = await client.from('users').select('*');
        if (allUsers.error) {
          throw new Error(allUsers.error.message || 'Failed to fetch user list for validation.');
        }

        try {
          validateAdminDelete(allUsers.data || [], targetUserId, {
            currentUserId: superAdmin.id,
            currentUserRole: superAdmin.role,
          });
        } catch (error: any) {
          return res.status(400).json({ error: error.message || 'Delete blocked.' });
        }

        const { error } = await client.from('users').delete().eq('id', targetUserId);
        if (error) {
          throw new Error(error.message || 'Failed to delete user account.');
        }

        await logActivity({
          actorEmail: superAdmin.email,
          actorRole: superAdmin.role,
          action: 'DELETE_ADMIN_USER',
          targetType: 'USER',
          targetId: String(targetUserId),
          classCode: existing.assigned_class || undefined,
          details: `Deleted administrator account ${existing.name} (${existing.email}).`,
        });

        return res.json({ deletedId: targetUserId });
      }

      const existingRows = await db
        .select()
        .from(users)
        .where(eq(users.id, targetUserId));
      if (existingRows.length === 0) {
        return res.status(404).json({ error: 'User account not found.' });
      }
      const existing = existingRows[0];

      const allUsers = await db.select().from(users);
      try {
        validateAdminDelete(allUsers, targetUserId, {
          currentUserId: superAdmin.id,
          currentUserRole: superAdmin.role,
        });
      } catch (error: any) {
        return res.status(400).json({ error: error.message || 'Delete blocked.' });
      }

      await db.delete(users).where(eq(users.id, targetUserId));

      await logActivity({
        actorEmail: superAdmin.email,
        actorRole: superAdmin.role,
        action: 'DELETE_ADMIN_USER',
        targetType: 'USER',
        targetId: String(targetUserId),
        classCode: existing.assignedClass || undefined,
        details: `Deleted administrator account ${existing.name} (${existing.email}).`,
      });

      return res.json({ deletedId: targetUserId });
    } catch (error: any) {
      return res
        .status(400)
        .json({ error: error.message || 'Failed to delete user account.' });
    }
  }
);

// ============================================================================
// 10. PLATFORM SETTINGS & FILE UPLOAD ENDPOINTS
// ============================================================================
app.put(
  '/api/admin/settings',
  requireAuth,
  requireGlobalControl,
  async (req: AuthRequest, res: Response) => {
    try {
      const superAdmin = req.adminUser!;
      const payload = req.body && typeof req.body === 'object' ? req.body : {};
      const settings =
        payload &&
        typeof payload === 'object' &&
        payload.settings &&
        typeof payload.settings === 'object' &&
        !Array.isArray(payload.settings)
          ? (payload.settings as Record<string, unknown>)
          : {};
      const classDescriptions = Array.isArray(payload.classDescriptions)
        ? payload.classDescriptions
        : [];

      for (const [key, value] of safeObjectEntries(settings)) {
        if (typeof key !== 'string' || !key.trim()) continue;

        await db
          .insert(platformSettings)
          .values({
            settingKey: key,
            settingValue: value == null ? '' : String(value),
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: platformSettings.settingKey,
            set: { settingValue: value == null ? '' : String(value), updatedAt: new Date() },
          });
      }

      for (const item of classDescriptions) {
        if (!item || typeof item !== 'object') continue;
        const classCode = item.code;
        if (classCode && isValidClass(String(classCode))) {
          await db
            .update(classes)
            .set({
              name: item.name ? String(item.name).trim() : undefined,
              description: item.description
                ? String(item.description).trim()
                : undefined,
              updatedAt: new Date(),
            })
            .where(eq(classes.code, String(classCode)));
        }
      }

      await logActivity({
        actorEmail: superAdmin.email,
        actorRole: superAdmin.role,
        action: 'UPDATE_PLATFORM_SETTINGS',
        targetType: 'SETTINGS',
        details: 'Updated global ILM platform settings and class metadata.',
      });

      return res.json({ message: 'Platform settings saved successfully.' });
    } catch (error: any) {
      return res
        .status(400)
        .json({ error: error.message || 'Failed to update platform settings.' });
    }
  }
);

const ALLOWED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.pdf',
  '.pptx',
  '.ppt',
  '.mp4',
  '.webm',
  '.mp3',
  '.wav',
  '.txt',
  '.md',
  '.ts',
  '.py',
  '.json',
]);

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

async function getEffectiveImgBBApiKey(): Promise<string | null> {
  const envKey = process.env.IMGBB_API_KEY;
  if (envKey && envKey !== 'MY_IMGBB_API_KEY' && envKey.trim()) {
    return envKey.trim();
  }
  try {
    const setting = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.settingKey, 'imgbbApiKey'))
      .limit(1);
    if (setting[0]?.settingValue && setting[0].settingValue.trim()) {
      return setting[0].settingValue.trim();
    }
  } catch (err) {
    console.warn('Could not read imgbbApiKey from platformSettings:', err);
  }
  return null;
}

async function getEffectiveSupabaseConfig(): Promise<{ url: string; key: string } | null> {
  let url = process.env.SUPABASE_URL || '';
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

  try {
    const records = await db.select().from(platformSettings);
    const map = normalizeSettingsMap(records);
    if (map.supabaseUrl && map.supabaseUrl.trim()) url = map.supabaseUrl.trim();
    if (map.supabaseServiceKey && map.supabaseServiceKey.trim()) {
      key = map.supabaseServiceKey.trim();
    } else if (map.supabaseAnonKey && map.supabaseAnonKey.trim()) {
      key = map.supabaseAnonKey.trim();
    }
  } catch (err) {
    console.warn('Could not read supabase settings from platformSettings:', err);
  }

  if (url && key && !url.includes('your-project')) {
    return { url, key };
  }
  return null;
}

function sendImgBBUploadRequest(
  apiKey: string,
  base64Image: string,
  name: string
): Promise<{ statusCode: number; success: boolean; data?: any; error?: string }> {
  return new Promise((resolve) => {
    const postData = new URLSearchParams({
      image: base64Image,
      name: name,
    }).toString();

    const req = https.request(
      {
        hostname: 'api.imgbb.com',
        port: 443,
        path: `/1/upload?key=${encodeURIComponent(apiKey.trim())}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': 'curl/7.88.1',
          'Accept': 'application/json',
        },
        timeout: 15000,
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(rawData);
            if (res.statusCode === 200 && parsed?.success && parsed?.data?.url) {
              resolve({
                statusCode: 200,
                success: true,
                data: parsed.data,
              });
            } else {
              resolve({
                statusCode: res.statusCode || 400,
                success: false,
                error: parsed?.error?.message || `ImgBB rejected upload (code ${res.statusCode})`,
              });
            }
          } catch {
            resolve({
              statusCode: res.statusCode || 500,
              success: false,
              error: 'Invalid response received from ImgBB API.',
            });
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({
        statusCode: 408,
        success: false,
        error: 'Upload to api.imgbb.com timed out after 20 seconds.',
      });
    });

    req.on('error', (err) => {
      resolve({
        statusCode: 500,
        success: false,
        error: err.message || 'Network error reaching api.imgbb.com',
      });
    });

    req.write(postData);
    req.end();
  });
}

async function uploadToImgBB(
  base64Clean: string,
  name: string
): Promise<string | null> {
  const apiKey = await getEffectiveImgBBApiKey();

  if (!apiKey) {
    console.warn('ImgBB upload skipped: IMGBB_API_KEY is not configured in env or platform settings.');
    return null;
  }

  try {
    const result = await sendImgBBUploadRequest(apiKey, base64Clean, name);
    if (result.success && result.data?.url) {
      return result.data.url;
    }
    console.warn('ImgBB upload failed:', result.error);
    return null;
  } catch (err) {
    console.warn('ImgBB upload request failed:', err);
    return null;
  }
}

// ============================================================================
// CLOUD DATABASE & IMGBB STATUS & TESTING ENDPOINTS
// ============================================================================
app.get('/api/admin/database-status', requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const imgbbKey = await getEffectiveImgBBApiKey();
    const supabaseConfig = await getEffectiveSupabaseConfig();
    const sheetdbConfig = getSheetDBConfig();

    return res.json({
      cloudSql: {
        engine: 'PostgreSQL',
        provider: 'Google Cloud SQL Developer Edition',
        region: 'asia-southeast1',
        status: 'CONNECTED',
      },
      imgbb: {
        status: imgbbKey ? 'CONFIGURED' : 'PENDING_KEY',
        apiKeyPreview: imgbbKey ? `${imgbbKey.slice(0, 4)}...${imgbbKey.slice(-4)}` : null,
      },
      supabase: {
        status: supabaseConfig ? 'CONFIGURED' : 'STANDBY',
        projectUrl: supabaseConfig ? supabaseConfig.url : null,
      },
      sheetdb: {
        status: sheetdbConfig ? 'CONFIGURED' : 'PENDING_KEY',
        apiUrl: sheetdbConfig ? sheetdbConfig.apiUrl : null,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to inspect database status.' });
  }
});

app.post('/api/admin/test-imgbb', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const testKey = req.body?.apiKey || (await getEffectiveImgBBApiKey());
    if (!testKey || !String(testKey).trim()) {
      return res.status(400).json({
        error: 'No ImgBB API Key provided. Please enter your API Key from https://api.imgbb.com/',
      });
    }

    // 1x1 transparent PNG base64
    const test1x1PngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const result = await sendImgBBUploadRequest(
      String(testKey).trim(),
      test1x1PngBase64,
      `ilm_test_ping_${Date.now()}`
    );

    if (result.success && result.data?.url) {
      return res.json({
        success: true,
        message: 'ImgBB API key is active and functional! Images will be permanently hosted on https://imgbb.com/',
        testImageUrl: result.data.url,
        deleteUrl: result.data.delete_url,
      });
    }

    return res.status(400).json({
      error: result.error || 'ImgBB test upload failed. Verify your API Key at https://api.imgbb.com/',
    });
  } catch (err: any) {
    return res.status(400).json({
      error: err.message || 'Network error attempting to verify ImgBB API Key.',
    });
  }
});

app.post('/api/admin/test-supabase', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { supabaseUrl, supabaseKey } = req.body || {};
    const effective = supabaseUrl && supabaseKey
      ? { url: String(supabaseUrl).trim(), key: String(supabaseKey).trim() }
      : await getEffectiveSupabaseConfig();

    if (!effective || !effective.url || !effective.key) {
      return res.status(400).json({
        error: 'Please provide both Supabase Project URL and Supabase Public/Anon API Key.',
      });
    }

    const testResult = await testSupabaseConnection(effective.url, effective.key);
    if (!testResult.success) {
      return res.status(400).json({ error: testResult.message });
    }

    return res.json({
      success: true,
      message: 'Supabase connection verified successfully! Ready to sync tables and records.',
    });
  } catch (err: any) {
    return res.status(400).json({
      error: err.message || 'Failed to verify Supabase connection.',
    });
  }
});

const SUPABASE_SCHEMA_SQL = `-- ============================================================================
-- ILM PLATFORM - SUPABASE POSTGRESQL TABLES DDL SCRIPT
-- Copy this entire script, open Supabase Dashboard -> "SQL Editor" -> "New query",
-- Paste it, and click "RUN" (Green button at bottom right).
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  assigned_class TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  password_hash TEXT,
  password_plain TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS classes (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  admin_email TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS students (
  id SERIAL PRIMARY KEY,
  admission_no TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  class_code TEXT NOT NULL,
  photo_url TEXT NOT NULL,
  bio TEXT,
  created_by_email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS class_officers (
  id SERIAL PRIMARY KEY,
  class_code TEXT NOT NULL,
  role_title TEXT NOT NULL,
  holder_name TEXT NOT NULL,
  admission_no TEXT,
  photo_url TEXT NOT NULL,
  responsibilities TEXT,
  updated_by_email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS competition_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  max_participants_per_class INTEGER NOT NULL,
  description TEXT NOT NULL,
  display_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS participants (
  id SERIAL PRIMARY KEY,
  admission_no TEXT,
  full_name TEXT NOT NULL,
  photo_url TEXT NOT NULL,
  class_code TEXT NOT NULL,
  category_name TEXT NOT NULL,
  own_topic TEXT,
  short_description TEXT,
  publication_status TEXT NOT NULL DEFAULT 'PUBLISHED',
  created_by_email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS posters (
  id SERIAL PRIMARY KEY,
  class_code TEXT NOT NULL,
  category_name TEXT NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL,
  poster_image_url TEXT NOT NULL,
  participants_snapshot TEXT NOT NULL,
  participant_count INTEGER NOT NULL DEFAULT 0,
  generation_status TEXT NOT NULL DEFAULT 'COMPLETED',
  generation_error TEXT,
  publication_status TEXT NOT NULL DEFAULT 'PUBLISHED',
  is_featured BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feed_posts (
  id SERIAL PRIMARY KEY,
  class_code TEXT NOT NULL,
  title TEXT NOT NULL,
  caption TEXT NOT NULL,
  media_url TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'PHOTO',
  status TEXT NOT NULL DEFAULT 'PENDING',
  rejection_reason TEXT,
  submitted_by_email TEXT NOT NULL,
  submitted_by_name TEXT NOT NULL,
  reviewed_by_email TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS weekly_results (
  id SERIAL PRIMARY KEY,
  result_category TEXT NOT NULL,
  winner_name TEXT NOT NULL,
  winner_photo_url TEXT NOT NULL,
  winner_class TEXT NOT NULL,
  week_label TEXT NOT NULL,
  result_date TEXT NOT NULL,
  remarks TEXT,
  publication_status TEXT NOT NULL DEFAULT 'PUBLISHED',
  published_by_email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS library_resources (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  author TEXT NOT NULL,
  category TEXT NOT NULL,
  library_scope TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size TEXT NOT NULL,
  content_preview TEXT,
  publication_status TEXT NOT NULL DEFAULT 'PUBLISHED',
  uploaded_by_email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id SERIAL PRIMARY KEY,
  actor_email TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  class_code TEXT,
  details TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_settings (
  id SERIAL PRIMARY KEY,
  setting_key TEXT NOT NULL UNIQUE,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure Row Level Security (RLS) is disabled so both Anon Key and backend can read and write smoothly:
ALTER TABLE classes DISABLE ROW LEVEL SECURITY;
ALTER TABLE students DISABLE ROW LEVEL SECURITY;
ALTER TABLE class_officers DISABLE ROW LEVEL SECURITY;
ALTER TABLE competition_categories DISABLE ROW LEVEL SECURITY;
ALTER TABLE participants DISABLE ROW LEVEL SECURITY;
ALTER TABLE posters DISABLE ROW LEVEL SECURITY;
ALTER TABLE feed_posts DISABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_results DISABLE ROW LEVEL SECURITY;
ALTER TABLE library_resources DISABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE platform_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;

-- Fallback permissive policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow All Classes') THEN
    CREATE POLICY "Allow All Classes" ON classes FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow All Categories') THEN
    CREATE POLICY "Allow All Categories" ON competition_categories FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow All Participants') THEN
    CREATE POLICY "Allow All Participants" ON participants FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow All Posters') THEN
    CREATE POLICY "Allow All Posters" ON posters FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow All Settings') THEN
    CREATE POLICY "Allow All Settings" ON platform_settings FOR ALL USING (true) WITH CHECK (true);
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
`;

app.get('/api/admin/supabase-schema-sql', requireAuth, (_req: AuthRequest, res: Response) => {
  return res.json({ sql: SUPABASE_SCHEMA_SQL });
});

app.post('/api/admin/sync-to-supabase', requireAuth, requireGlobalControl, async (_req: AuthRequest, res: Response) => {
  try {
    const config = await getEffectiveSupabaseConfig();
    if (!config) {
      return res.status(400).json({ error: 'Supabase URL or Key not configured. Please enter them in Settings.' });
    }
    const client = getSupabaseClient(config.url, config.key);
    if (!client) {
      return res.status(400).json({ error: 'Could not connect to Supabase client.' });
    }

    // Check if classes table exists
    const testCheck = await client.from('classes').select('id').limit(1);
    if (testCheck.error) {
      return res.status(400).json({
        error: `Supabase me tables abhi nahi bane hain (${testCheck.error.message}). Please pehle SQL Editor me ja kar 'Copy Supabase SQL' wala code RUN karein!`,
        requiresSchema: true,
      });
    }

    const allCls = await db.select().from(classes);
    for (const c of allCls) {
      await client.from('classes').upsert({
        code: c.code,
        name: c.name,
        description: c.description,
        admin_email: c.adminEmail,
      }, { onConflict: 'code' });
    }

    const allCats = await db.select().from(competitionCategories);
    for (const cat of allCats) {
      await client.from('competition_categories').upsert({
        name: cat.name,
        max_participants_per_class: cat.maxParticipantsPerClass,
        description: cat.description,
        display_order: cat.displayOrder,
      }, { onConflict: 'name' });
    }

    const allStudents = await db.select().from(students);
    for (const student of allStudents) {
      await client.from('students').upsert({
        id: student.id,
        admission_no: student.admissionNo,
        full_name: student.fullName,
        class_code: student.classCode,
        photo_url: student.photoUrl,
        bio: student.bio,
        created_by_email: student.createdByEmail,
      }, { onConflict: 'id' });
    }

    const allOfficers = await db.select().from(classOfficers);
    for (const officer of allOfficers) {
      await client.from('class_officers').upsert({
        id: officer.id,
        class_code: officer.classCode,
        role_title: officer.roleTitle,
        holder_name: officer.holderName,
        admission_no: officer.admissionNo,
        photo_url: officer.photoUrl,
        responsibilities: officer.responsibilities,
        updated_by_email: officer.updatedByEmail,
      }, { onConflict: 'id' });
    }

    const allParts = await db.select().from(participants);
    for (const p of allParts) {
      await client.from('participants').upsert({
        id: p.id,
        admission_no: p.admissionNo,
        full_name: p.fullName,
        photo_url: p.photoUrl,
        class_code: p.classCode,
        category_name: p.categoryName,
        own_topic: p.ownTopic,
        short_description: p.shortDescription,
        publication_status: p.publicationStatus,
        created_by_email: p.createdByEmail,
      }, { onConflict: 'id' });
    }

    const allPosters = await db.select().from(posters);
    for (const pos of allPosters) {
      await client.from('posters').upsert({
        id: pos.id,
        class_code: pos.classCode,
        category_name: pos.categoryName,
        title: pos.title,
        subtitle: pos.subtitle,
        poster_image_url: pos.posterImageUrl,
        participants_snapshot: pos.participantsSnapshot,
        participant_count: pos.participantCount,
        generation_status: pos.generationStatus,
        generation_error: pos.generationError,
        publication_status: pos.publicationStatus,
        is_featured: pos.isFeatured,
      }, { onConflict: 'id' });
    }

    const allFeedPosts = await db.select().from(feedPosts);
    for (const fp of allFeedPosts) {
      await client.from('feed_posts').upsert({
        id: fp.id,
        class_code: fp.classCode,
        title: fp.title,
        caption: fp.caption,
        media_url: fp.mediaUrl,
        media_type: fp.mediaType,
        status: fp.status,
        rejection_reason: fp.rejectionReason,
        submitted_by_email: fp.submittedByEmail,
        submitted_by_name: fp.submittedByName,
        reviewed_by_email: fp.reviewedByEmail,
        reviewed_at: fp.reviewedAt,
      }, { onConflict: 'id' });
    }

    const allResults = await db.select().from(weeklyResults);
    for (const result of allResults) {
      await client.from('weekly_results').upsert({
        id: result.id,
        result_category: result.resultCategory,
        winner_name: result.winnerName,
        winner_photo_url: result.winnerPhotoUrl,
        winner_class: result.winnerClass,
        week_label: result.weekLabel,
        result_date: result.resultDate,
        remarks: result.remarks,
        publication_status: result.publicationStatus,
        published_by_email: result.publishedByEmail,
      }, { onConflict: 'id' });
    }

    const allLibrary = await db.select().from(libraryResources);
    for (const resource of allLibrary) {
      await client.from('library_resources').upsert({
        id: resource.id,
        title: resource.title,
        description: resource.description,
        author: resource.author,
        category: resource.category,
        library_scope: resource.libraryScope,
        file_url: resource.fileUrl,
        file_type: resource.fileType,
        file_size: resource.fileSize,
        content_preview: resource.contentPreview,
        publication_status: resource.publicationStatus,
        uploaded_by_email: resource.uploadedByEmail,
      }, { onConflict: 'id' });
    }

    const allLogs = await db.select().from(activityLogs);
    for (const log of allLogs) {
      await client.from('activity_logs').upsert({
        id: log.id,
        actor_email: log.actorEmail,
        actor_role: log.actorRole,
        action: log.action,
        target_type: log.targetType,
        target_id: log.targetId,
        class_code: log.classCode,
        details: log.details,
      }, { onConflict: 'id' });
    }

    const allUsers = await db.select().from(users);
    for (const user of allUsers) {
      await client.from('users').upsert({
        id: user.id,
        uid: user.uid,
        email: user.email,
        name: user.name,
        role: user.role,
        assigned_class: user.assignedClass,
        status: user.status,
        password_hash: user.passwordHash,
        password_plain: user.passwordPlain,
      }, { onConflict: 'id' });
    }

    const allSettings = await db.select().from(platformSettings);
    for (const s of allSettings) {
      await client.from('platform_settings').upsert({
        setting_key: s.settingKey,
        setting_value: s.settingValue,
      }, { onConflict: 'setting_key' });
    }

    return res.json({
      success: true,
      message: `Successfully synchronized ${allStudents.length} students, ${allOfficers.length} class officers, ${allParts.length} participants, ${allPosters.length} posters, ${allFeedPosts.length} feed posts, ${allResults.length} weekly results, ${allLibrary.length} library resources, ${allUsers.length} users, and platform settings to Supabase!`,
      counts: {
        classes: allCls.length,
        students: allStudents.length,
        classOfficers: allOfficers.length,
        participants: allParts.length,
        posters: allPosters.length,
        feedPosts: allFeedPosts.length,
        weeklyResults: allResults.length,
        libraryResources: allLibrary.length,
        users: allUsers.length,
        categories: allCats.length,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Sync to Supabase failed.' });
  }
});

app.post(
  '/api/admin/upload',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { fileName, base64Data } = req.body || {};
      if (!fileName || !base64Data) {
        return res
          .status(400)
          .json({ error: 'File name and file data are required.' });
      }

      const ext = path.extname(String(fileName)).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        return res.status(400).json({
          error: `Unsupported or unsafe file extension '${ext}'. Allowed formats: JPG, PNG, WEBP, GIF, PDF, PPTX, MP4, MP3, TXT, TS, JSON.`,
        });
      }

      // Extract raw base64 payload if data URL prefix is included
      const base64Clean = String(base64Data).includes(',')
        ? String(base64Data).split(',')[1]
        : String(base64Data);

      const buffer = Buffer.from(base64Clean, 'base64');
      if (buffer.byteLength > 15 * 1024 * 1024) {
        return res
          .status(400)
          .json({ error: 'File size exceeds the 15 MB maximum upload limit.' });
      }

      const safeBase = path
        .basename(String(fileName), ext)
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 48);

      const sizeKB = Math.max(1, Math.round(buffer.byteLength / 1024));
      const formattedSize =
        sizeKB >= 1024
          ? `${(sizeKB / 1024).toFixed(1)} MB`
          : `${sizeKB} KB`;

      // If this is an image file, save it directly to https://imgbb.com/ using the configured API key
      if (IMAGE_EXTENSIONS.has(ext)) {
        const imgbbUrl = await uploadToImgBB(
          base64Clean,
          `${safeBase}_${Date.now()}`
        );
        if (imgbbUrl) {
          return res.status(201).json({
            fileUrl: imgbbUrl,
            hostedOn: 'imgbb.com',
            fileType: ext.replace('.', '').toUpperCase(),
            fileSize: formattedSize,
          });
        }
      }

      const finalName = `${safeBase}_${Date.now()}${ext}`;
      const filePath = path.join(uploadsDir, finalName);

      fs.writeFileSync(filePath, buffer);

      return res.status(201).json({
        fileUrl: `/uploads/${finalName}`,
        fileType: ext.replace('.', '').toUpperCase(),
        fileSize: formattedSize,
      });
    } catch (error: any) {
      console.error('Upload error:', error);
      return res
        .status(400)
        .json({ error: 'File upload failed. Please check the file format.' });
    }
  }
);

// ============================================================================
// VITE DEV MIDDLEWARE OR PRODUCTION STATIC ASSETS
// ============================================================================
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`  ➜  Local:   http://localhost:${PORT}/`);
    console.log(`  ➜  Network: http://0.0.0.0:${PORT}/`);
    console.log(`ILM — Integrated Learning Master server running on port ${PORT}`);
  });

  const cleanup = () => {
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

if (!process.env.VERCEL) {
  void startServer();
}
