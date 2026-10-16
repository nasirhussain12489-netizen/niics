import crypto from 'crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db, getDbOrThrow } from './index.ts';
import {
  OFFLINE_PARTICIPANTS,
  buildFallbackPosterForClass,
  getOfflineAdminUser,
  getOfflineParticipantsForClass,
  isSqlConfigured,
  removeOfflineParticipant,
  upsertOfflineParticipant,
  upsertOfflinePoster,
} from '../lib/bootstrap.ts';
import {
  createSupabaseAdminUser,
  getSupabaseClient,
  getSupabaseUserByEmail,
  getSupabaseUsersByClass,
  hasSupabaseRuntimeConfig,
} from '../lib/supabase.ts';
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
} from './schema.ts';
import { buildIlmPosterSvg, svgToDataUrl } from '../lib/posterSvg.ts';
import { safeObjectEntries } from '../lib/settings.ts';

export const VALID_CLASSES = ['U1', 'U2', 'U3', 'U4', 'U5', 'U6'] as const;
export type ValidClassCode = (typeof VALID_CLASSES)[number];

export const CATEGORY_LIMITS: Record<string, number> = {
  Qirat: 1,
  Naat: 5,
  Speech: 5,
  'Table Topic': 5,
  'Aah Counter': 1,
  Evolution: 5,
  Marshal: 1,
  Grammarian: 1,
};

export const VALID_CATEGORIES = Object.keys(CATEGORY_LIMITS);

export const CLASS_OFFICER_ROLES = [
  'Class Teacher',
  'President',
  'Vice President of Membership',
  'Vice President of Education',
  'Vice President of Public Relations',
  'Secretary',
  'Treasurer',
] as const;

export const LIBRARY_CATEGORIES = [
  'Books',
  'Articles',
  'Journals',
  'Research Papers',
  'Notes',
  'Presentations',
  'Videos',
  'Images',
  'Audio',
  'Code Snippets',
  'Bookmarks',
] as const;

export const RESULT_CATEGORIES = ['Best Speaker', 'Best Naat'] as const;

export function isValidClass(code: string): code is ValidClassCode {
  return VALID_CLASSES.includes(code as ValidClassCode);
}

export function hashPassword(password: string): string {
  const salt = 'ilm_integrated_learning_master_v1_salt';
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

const TOKEN_SECRET =
  process.env.SESSION_SECRET ||
  crypto
    .createHash('sha256')
    .update(process.env.SQL_PASSWORD || 'ilm_session_key_2026')
    .digest('hex');

export function createSessionToken(payload: {
  uid: string;
  email: string;
  role: string;
  assignedClass: string | null;
}): string {
  const exp = Date.now() + 1000 * 60 * 60 * 12; // 12 hours expiration
  const data = Buffer.from(JSON.stringify({ ...payload, exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(data).digest('base64url');
  return `ilm.${data}.${sig}`;
}

export function verifySessionToken(token: string): {
  uid: string;
  email: string;
  role: string;
  assignedClass: string | null;
} | null {
  try {
    if (!token.startsWith('ilm.')) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [, data, sig] = parts;
    const expectedSig = crypto
      .createHmac('sha256', TOKEN_SECRET)
      .update(data)
      .digest('base64url');
    if (sig !== expectedSig) return null;
    const decoded = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (!decoded.exp || Date.now() > decoded.exp) return null;
    return {
      uid: decoded.uid,
      email: decoded.email,
      role: decoded.role,
      assignedClass: decoded.assignedClass || null,
    };
  } catch {
    return null;
  }
}

export async function logActivity(params: {
  actorEmail: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId?: string;
  classCode?: string;
  details: string;
}) {
  try {
    if (hasSupabaseRuntimeConfig()) {
      const client = getSupabaseClient();
      if (client) {
        const { error } = await client.from('activity_logs').insert({
          actor_email: params.actorEmail,
          actor_role: params.actorRole,
          action: params.action,
          target_type: params.targetType,
          target_id: params.targetId || null,
          class_code: params.classCode || null,
          details: params.details,
        });
        if (!error) return;
        console.warn('Supabase activity log write failed:', error.message);
        return;
      }
    }

    if (!isSqlConfigured()) {
      return;
    }

    await db.insert(activityLogs).values({
      actorEmail: params.actorEmail,
      actorRole: params.actorRole,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId || null,
      classCode: params.classCode || null,
      details: params.details,
    });
  } catch (error) {
    console.error('Failed to write activity log:', error);
  }
}

export async function getOrCreateFirebaseAdminUser(
  uid: string,
  email: string,
  displayName?: string
) {
  try {
    const normalizedEmail = email.trim().toLowerCase();
    const offlineUser = getOfflineAdminUser(normalizedEmail);
    if (!isSqlConfigured()) {
      const supabaseUser = await getSupabaseUserByEmail(normalizedEmail);
      if (supabaseUser) return supabaseUser;
      if (!offlineUser) return null;
      return {
        ...offlineUser,
        passwordHash: hashPassword(offlineUser.passwordPlain),
      };
    }

    try {
      const existingByEmail = await db
        .select()
        .from(users)
        .where(eq(users.email, normalizedEmail));

      if (existingByEmail.length > 0) {
        const existing = existingByEmail[0];
        if (existing.uid !== uid) {
          const updated = await db
            .update(users)
            .set({ uid, updatedAt: new Date() })
            .where(eq(users.id, existing.id))
            .returning();
          return updated[0];
        }
        return existing;
      }

    // Bootstrap owner email as SUPER_ADMIN
    if (
      normalizedEmail === 'nasirhussain12489@gmail.com' ||
      normalizedEmail === 'nasirhussin12489@gmail.com'
    ) {
      const inserted = await db
        .insert(users)
        .values({
          uid,
          email: normalizedEmail,
          name: displayName || 'Nasir Hussain (Super Admin)',
          role: 'SUPER_ADMIN',
          assignedClass: null,
          status: 'ACTIVE',
        })
        .onConflictDoUpdate({
          target: users.uid,
          set: { email: normalizedEmail, updatedAt: new Date() },
        })
        .returning();
      return inserted[0];
    }

      return null;
    } catch (error) {
      if (offlineUser) {
        console.warn('SQL admin lookup failed, falling back to offline admin user:', error);
        return {
          ...offlineUser,
          passwordHash: hashPassword(offlineUser.passwordPlain),
        };
      }
      console.error('Database query failed in getOrCreateFirebaseAdminUser:', error);
      throw new Error('Failed to verify administrator account.', { cause: error });
    }
  } catch (error) {
    console.error('Database query failed in getOrCreateFirebaseAdminUser:', error);
    throw new Error('Failed to verify administrator account.', { cause: error });
  }
}

export async function getUserByEmail(email: string) {
  try {
    const normalized = email.trim().toLowerCase();
    const offlineUser = getOfflineAdminUser(normalized);
    if (!isSqlConfigured()) {
      const supabaseUser = await getSupabaseUserByEmail(normalized);
      if (supabaseUser) return supabaseUser;
      if (!offlineUser) return null;
      return {
        ...offlineUser,
        passwordHash: hashPassword(offlineUser.passwordPlain),
      };
    }

    try {
      const rows = await db.select().from(users).where(eq(users.email, normalized));
      return rows[0] || null;
    } catch (error) {
      if (offlineUser) {
        console.warn('SQL auth lookup failed, falling back to offline admin user:', error);
        return {
          ...offlineUser,
          passwordHash: hashPassword(offlineUser.passwordPlain),
        };
      }
      console.warn('SQL auth lookup failed and no offline fallback matched:', error);
      return null;
    }
  } catch (error) {
    console.error('Database query failed in getUserByEmail:', error);
    return null;
  }
}

export async function regeneratePosterForClassCategory(
  classCode: string,
  _categoryName?: string
) {
  try {
    if (!isValidClass(classCode)) {
      throw new Error(`Invalid class code: ${classCode}`);
    }

    if (!isSqlConfigured()) {
      const offlineParticipants = getOfflineParticipantsForClass(classCode).filter(
        (p) => p.publicationStatus !== 'DRAFT'
      );
      const poster = buildFallbackPosterForClass(
        classCode,
        offlineParticipants.map((p) => ({
          id: p.id,
          admissionNo: p.admissionNo,
          fullName: p.fullName,
          photoUrl: p.photoUrl,
          classCode: p.classCode,
          categoryName: p.categoryName,
          ownTopic: p.ownTopic,
        }))
      );
      return upsertOfflinePoster(poster);
    }

    // Fetch ALL published participants in this class across all 8 competition categories
    const allClassParticipants = await db
      .select()
      .from(participants)
      .where(
        and(
          eq(participants.classCode, classCode),
          eq(participants.publicationStatus, 'PUBLISHED')
        )
      )
      .orderBy(asc(participants.id));

    const classSnapshot = allClassParticipants.map((p) => ({
      id: p.id,
      admissionNo: p.admissionNo || null,
      fullName: p.fullName,
      photoUrl: p.photoUrl,
      classCode: p.classCode,
      categoryName: p.categoryName,
      ownTopic: p.ownTopic || null,
    }));

    const unifiedCategoryLabel = 'All Categories';
    const classTitle = `${classCode} Class Competition Lineup`;
    const classSubtitle = `Unified Class Poster · ${allClassParticipants.length} / 24 Registered Candidates Across Qirat, Naat, Speech, Table Topic, Evolution, Aah Counter, Marshal & Grammarian`;

    const classSvg = buildIlmPosterSvg({
      classCode,
      categoryName: unifiedCategoryLabel,
      title: classTitle,
      subtitle: classSubtitle,
      participants: classSnapshot,
    });
    const classDataUrl = svgToDataUrl(classSvg);

    const existingClassPosters = await db
      .select()
      .from(posters)
      .where(eq(posters.classCode, classCode))
      .orderBy(asc(posters.id));

    let updatedPoster;
    if (existingClassPosters.length > 0) {
      const primaryId = existingClassPosters[0].id;
      const res = await db
        .update(posters)
        .set({
          categoryName: unifiedCategoryLabel,
          title: classTitle,
          subtitle: classSubtitle,
          posterImageUrl: classDataUrl,
          participantsSnapshot: JSON.stringify(classSnapshot),
          participantCount: allClassParticipants.length,
          generationStatus: 'COMPLETED',
          generationError: null,
          updatedAt: new Date(),
        })
        .where(eq(posters.id, primaryId))
        .returning();
      updatedPoster = res[0];

      // Remove any extra split category posters for this class so there is 1 unified poster per class
      for (let i = 1; i < existingClassPosters.length; i++) {
        await db
          .delete(posters)
          .where(eq(posters.id, existingClassPosters[i].id));
      }
    } else {
      const res = await db
        .insert(posters)
        .values({
          classCode,
          categoryName: unifiedCategoryLabel,
          title: classTitle,
          subtitle: classSubtitle,
          posterImageUrl: classDataUrl,
          participantsSnapshot: JSON.stringify(classSnapshot),
          participantCount: allClassParticipants.length,
          generationStatus: 'COMPLETED',
          generationError: null,
          publicationStatus: 'PUBLISHED',
          isFeatured: true,
        })
        .returning();
      updatedPoster = res[0];
    }

    return updatedPoster;
  } catch (error) {
    console.error('Poster generation failed:', error);
    throw new Error('Failed to generate unified class poster.', {
      cause: error,
    });
  }
}

export async function createParticipantWithPoster(params: {
  admissionNo?: string;
  fullName: string;
  photoUrl: string;
  classCode: string;
  categoryName: string;
  ownTopic?: string;
  shortDescription?: string;
  publicationStatus?: string;
  actorEmail: string;
  actorRole: string;
}) {
  const {
    admissionNo,
    fullName,
    photoUrl,
    classCode,
    categoryName,
    ownTopic,
    shortDescription,
    publicationStatus = 'PUBLISHED',
    actorEmail,
    actorRole,
  } = params;

  if (!isValidClass(classCode)) {
    throw new Error(
      `Invalid class '${classCode}'. Only classes U1, U2, U3, U4, U5, and U6 are permitted.`
    );
  }
  const maxAllowed = CATEGORY_LIMITS[categoryName];
  if (!maxAllowed) {
    throw new Error(
      `Invalid competition category '${categoryName}'. Allowed categories: ${VALID_CATEGORIES.join(
        ', '
      )}.`
    );
  }
  if (!fullName || !fullName.trim()) {
    throw new Error('Participant full name is required.');
  }
  if (!photoUrl || !photoUrl.trim()) {
    throw new Error('Participant photograph is required.');
  }

  if (!isSqlConfigured()) {
    const created = upsertOfflineParticipant({
      admissionNo: admissionNo?.trim() || null,
      fullName: fullName.trim(),
      photoUrl: photoUrl.trim(),
      classCode,
      categoryName,
      ownTopic: ownTopic?.trim() || null,
      shortDescription: shortDescription?.trim() || null,
      publicationStatus,
      createdByEmail: actorEmail,
    });

    const poster = await regeneratePosterForClassCategory(classCode, categoryName);
    await logActivity({
      actorEmail,
      actorRole,
      action: 'ADD_PARTICIPANT_AND_GENERATE_POSTER',
      targetType: 'PARTICIPANT',
      targetId: String(created.id),
      classCode,
      details: `Registered ${created.fullName}${created.admissionNo ? ` (${created.admissionNo})` : ''} in ${classCode} (${categoryName}) and auto-updated ${classCode} class poster.`,
    });

    return { participant: created, poster };
  }

  let createdParticipant;
  try {
    const sqlDb = getDbOrThrow();
    createdParticipant = await sqlDb.transaction(async (tx) => {
      // Lock class record to serialize simultaneous capacity checks per class
      await tx.select().from(classes).where(eq(classes.code, classCode));

      const currentInCategory = await tx
        .select()
        .from(participants)
        .where(
          and(
            eq(participants.classCode, classCode),
            eq(participants.categoryName, categoryName)
          )
        );

      if (currentInCategory.length >= maxAllowed) {
        throw new Error(
          `Capacity reached: ${categoryName} in class ${classCode} allows a maximum of ${maxAllowed} participant(s) (${currentInCategory.length}/${maxAllowed} registered).`
        );
      }

      const duplicate = currentInCategory.find(
        (p) => p.fullName.trim().toLowerCase() === fullName.trim().toLowerCase()
      );
      if (duplicate) {
        throw new Error(
          `Duplicate assignment prevented: '${fullName.trim()}' is already registered in ${categoryName} for class ${classCode}.`
        );
      }

      const cleanAdm = admissionNo?.trim() || null;

      // Also sync into students table if admissionNo is provided
      if (cleanAdm) {
        await tx
          .insert(students)
          .values({
            admissionNo: cleanAdm,
            fullName: fullName.trim(),
            classCode,
            photoUrl: photoUrl.trim(),
            bio: shortDescription?.trim() || null,
            createdByEmail: actorEmail,
          })
          .onConflictDoNothing();
      }

      const inserted = await tx
        .insert(participants)
        .values({
          admissionNo: cleanAdm,
          fullName: fullName.trim(),
          photoUrl: photoUrl.trim(),
          classCode,
          categoryName,
          ownTopic: ownTopic?.trim() || null,
          shortDescription: shortDescription?.trim() || null,
          publicationStatus,
          createdByEmail: actorEmail,
        })
        .returning();

      return inserted[0];
    });
  } catch (error: any) {
    console.error('Transaction failed in createParticipantWithPoster:', error);
    throw new Error(error.message || 'Failed to register participant.', {
      cause: error,
    });
  }

  // Automatically generate/update unified class poster
  const poster = await regeneratePosterForClassCategory(classCode, categoryName);

  await logActivity({
    actorEmail,
    actorRole,
    action: 'ADD_PARTICIPANT_AND_GENERATE_POSTER',
    targetType: 'PARTICIPANT',
    targetId: String(createdParticipant.id),
    classCode,
    details: `Registered ${createdParticipant.fullName}${
      createdParticipant.admissionNo ? ` (${createdParticipant.admissionNo})` : ''
    } in ${classCode} (${categoryName}) and auto-updated ${classCode} class poster.`,
  });

  return { participant: createdParticipant, poster };
}

export async function updateParticipantWithPoster(params: {
  id: number;
  admissionNo?: string;
  fullName?: string;
  photoUrl?: string;
  classCode?: string;
  categoryName?: string;
  ownTopic?: string;
  shortDescription?: string;
  publicationStatus?: string;
  actorEmail: string;
  actorRole: string;
}) {
  try {
    if (!isSqlConfigured()) {
      const fallbackParticipant =
        OFFLINE_PARTICIPANTS.find((item) => item.id === params.id) ||
        getOfflineParticipantsForClass(params.classCode || '').find((item) => item.id === params.id) ||
        getOfflineParticipantsForClass('U1').find((item) => item.id === params.id);

      if (!fallbackParticipant) {
        throw new Error('Participant record not found.');
      }

      const targetClass = params.classCode || fallbackParticipant.classCode;
      const targetCategory = params.categoryName || fallbackParticipant.categoryName;
      const targetName = (params.fullName ?? fallbackParticipant.fullName).trim();

      if (!isValidClass(targetClass)) {
        throw new Error(`Invalid class '${targetClass}'. Only U1–U6 are allowed.`);
      }

      const nextParticipant = upsertOfflineParticipant({
        id: fallbackParticipant.id,
        admissionNo: params.admissionNo ?? fallbackParticipant.admissionNo,
        fullName: targetName,
        photoUrl: (params.photoUrl ?? fallbackParticipant.photoUrl).trim(),
        classCode: targetClass,
        categoryName: targetCategory,
        ownTopic: params.ownTopic ?? fallbackParticipant.ownTopic,
        shortDescription: params.shortDescription ?? fallbackParticipant.shortDescription,
        publicationStatus: params.publicationStatus ?? fallbackParticipant.publicationStatus,
        createdByEmail: fallbackParticipant.createdByEmail,
      });

      const poster = await regeneratePosterForClassCategory(
        targetClass,
        targetCategory
      );

      await logActivity({
        actorEmail: params.actorEmail,
        actorRole: params.actorRole,
        action: 'UPDATE_PARTICIPANT_AND_REGENERATE_POSTER',
        targetType: 'PARTICIPANT',
        targetId: String(nextParticipant.id),
        classCode: targetClass,
        details: `Updated participant ${nextParticipant.fullName} (${targetClass} · ${targetCategory}) and regenerated poster.`,
      });

      return { participant: nextParticipant, poster };
    }

    const existingRows = await db
      .select()
      .from(participants)
      .where(eq(participants.id, params.id));

    if (existingRows.length === 0) {
      throw new Error('Participant record not found.');
    }
    const existing = existingRows[0];
    const targetClass = params.classCode || existing.classCode;
    const targetCategory = params.categoryName || existing.categoryName;
    const targetName = (params.fullName ?? existing.fullName).trim();

    if (!isValidClass(targetClass)) {
      throw new Error(`Invalid class '${targetClass}'. Only U1–U6 are allowed.`);
    }
    const maxAllowed = CATEGORY_LIMITS[targetCategory];
    if (!maxAllowed) {
      throw new Error(`Invalid competition category '${targetCategory}'.`);
    }

    const updated = await db.transaction(async (tx) => {
      const currentInTarget = await tx
        .select()
        .from(participants)
        .where(
          and(
            eq(participants.classCode, targetClass),
            eq(participants.categoryName, targetCategory)
          )
        );

      const othersInTarget = currentInTarget.filter((p) => p.id !== existing.id);

      if (othersInTarget.length >= maxAllowed) {
        throw new Error(
          `Capacity reached: ${targetCategory} in class ${targetClass} allows a maximum of ${maxAllowed} participant(s).`
        );
      }

      const duplicate = othersInTarget.find(
        (p) => p.fullName.trim().toLowerCase() === targetName.toLowerCase()
      );
      if (duplicate) {
        throw new Error(
          `Duplicate assignment prevented: '${targetName}' is already registered in ${targetCategory} for class ${targetClass}.`
        );
      }

      const res = await tx
        .update(participants)
        .set({
          admissionNo:
            params.admissionNo !== undefined
              ? params.admissionNo.trim() || null
              : existing.admissionNo,
          fullName: targetName,
          photoUrl: (params.photoUrl ?? existing.photoUrl).trim(),
          classCode: targetClass,
          categoryName: targetCategory,
          ownTopic:
            params.ownTopic !== undefined
              ? params.ownTopic.trim() || null
              : existing.ownTopic,
          shortDescription:
            params.shortDescription !== undefined
              ? params.shortDescription
              : existing.shortDescription,
          publicationStatus: params.publicationStatus ?? existing.publicationStatus,
          updatedAt: new Date(),
        })
        .where(eq(participants.id, existing.id))
        .returning();

      return res[0];
    });

    if (
      existing.classCode !== targetClass ||
      existing.categoryName !== targetCategory
    ) {
      await regeneratePosterForClassCategory(
        existing.classCode,
        existing.categoryName
      );
    }

    const poster = await regeneratePosterForClassCategory(
      targetClass,
      targetCategory
    );

    await logActivity({
      actorEmail: params.actorEmail,
      actorRole: params.actorRole,
      action: 'UPDATE_PARTICIPANT_AND_REGENERATE_POSTER',
      targetType: 'PARTICIPANT',
      targetId: String(updated.id),
      classCode: targetClass,
      details: `Updated participant ${updated.fullName} (${targetClass} · ${targetCategory}) and regenerated poster.`,
    });

    return { participant: updated, poster };
  } catch (error: any) {
    console.error('Failed to update participant:', error);
    throw new Error(error.message || 'Failed to update participant.', {
      cause: error,
    });
  }
}

export async function deleteParticipantWithPoster(params: {
  id: number;
  actorEmail: string;
  actorRole: string;
}) {
  try {
    if (!isSqlConfigured()) {
      const existing = OFFLINE_PARTICIPANTS.find((item) => item.id === params.id);
      if (!existing) {
        throw new Error('Participant record not found.');
      }

      removeOfflineParticipant(params.id);
      const poster = await regeneratePosterForClassCategory(
        existing.classCode,
        existing.categoryName
      );

      await logActivity({
        actorEmail: params.actorEmail,
        actorRole: params.actorRole,
        action: 'REMOVE_PARTICIPANT_AND_REGENERATE_POSTER',
        targetType: 'PARTICIPANT',
        targetId: String(existing.id),
        classCode: existing.classCode,
        details: `Removed participant ${existing.fullName} from ${existing.classCode} (${existing.categoryName}) and regenerated poster.`,
      });

      return { removed: existing, poster };
    }

    const existingRows = await db
      .select()
      .from(participants)
      .where(eq(participants.id, params.id));

    if (existingRows.length === 0) {
      throw new Error('Participant record not found.');
    }
    const existing = existingRows[0];

    await db.delete(participants).where(eq(participants.id, existing.id));

    const poster = await regeneratePosterForClassCategory(
      existing.classCode,
      existing.categoryName
    );

    await logActivity({
      actorEmail: params.actorEmail,
      actorRole: params.actorRole,
      action: 'REMOVE_PARTICIPANT_AND_REGENERATE_POSTER',
      targetType: 'PARTICIPANT',
      targetId: String(existing.id),
      classCode: existing.classCode,
      details: `Removed participant ${existing.fullName} from ${existing.classCode} (${existing.categoryName}) and regenerated poster.`,
    });

    return { removed: existing, poster };
  } catch (error: any) {
    console.error('Failed to delete participant:', error);
    throw new Error(error.message || 'Failed to delete participant.', {
      cause: error,
    });
  }
}

let isSeeding = false;
let seedCompleted = false;
let credentialsSynced = false;

export async function ensureRequestedAdminCredentials() {
  if (credentialsSynced) return;
  try {
    const superAdminPwHash = hashPassword('9934886605dilD@');
    const teacherPwHash = hashPassword('123456789teacher');

    const classAdminSeed = [
      { classCode: 'U1', email: 'u1admin@gmail.com', name: 'U1 Class Admin', password: 'u1admin@2026' },
      { classCode: 'U2', email: 'u2admin@gmail.com', name: 'U2 Class Admin', password: 'u2admin@2026' },
      { classCode: 'U3', email: 'u3admin@gmail.com', name: 'U3 Class Admin', password: 'u3admin@2026' },
      { classCode: 'U4', email: 'u4admin@gmail.com', name: 'U4 Class Admin', password: 'u4admin@2026' },
      { classCode: 'U5', email: 'u5admin@gmail.com', name: 'U5 Class Admin', password: 'u5admin@2026' },
      { classCode: 'U6', email: 'u6admin@gmail.com', name: 'U6 Class Admin', password: 'u6admin@2026' },
    ] as const;

    // 1. Ensure Super Admin accounts are active with password 9934886605dilD@
    for (const [uidKey, emailVal, nameVal] of [
      ['superadmin-nasir-1', 'nasirhussin12489@gmail.com', 'Nasir Hussain (Super Admin)'],
      ['superadmin-owner-uid', 'nasirhussain12489@gmail.com', 'Nasir Hussain (Super Admin)'],
      ['superadmin-dilshad', 'dilshad1345@gmail.com', 'Dilshad (Super Admin)'],
    ] as const) {
      const existing = await db
        .select()
        .from(users)
        .where(eq(users.email, emailVal));
      if (existing.length > 0) {
        await db
          .update(users)
          .set({
            role: 'SUPER_ADMIN',
            assignedClass: null,
            status: 'ACTIVE',
            passwordHash: existing[0].passwordHash || superAdminPwHash,
            passwordPlain: existing[0].passwordPlain || '9934886605dilD@',
            updatedAt: new Date(),
          })
          .where(eq(users.id, existing[0].id));
      } else {
        await db
          .insert(users)
          .values({
            uid: uidKey,
            email: emailVal,
            name: nameVal,
            role: 'SUPER_ADMIN',
            assignedClass: null,
            status: 'ACTIVE',
            passwordHash: superAdminPwHash,
            passwordPlain: '9934886605dilD@',
          })
          .onConflictDoNothing();
      }
    }

    // 1b. Ensure primary Teacher account (teacher@gmail.com) is active with full control except user management
    const existingTeacher = await db
      .select()
      .from(users)
      .where(eq(users.email, 'teacher@gmail.com'));
    if (existingTeacher.length > 0) {
      await db
        .update(users)
        .set({
          name: existingTeacher[0].name || 'ILM Faculty Teacher',
          role: 'TEACHER',
          assignedClass: null,
          status: 'ACTIVE',
          passwordHash: existingTeacher[0].passwordHash || teacherPwHash,
          passwordPlain: existingTeacher[0].passwordPlain || '123456789teacher',
          updatedAt: new Date(),
        })
        .where(eq(users.id, existingTeacher[0].id));
    } else {
      await db
        .insert(users)
        .values({
          uid: 'teacher-primary-faculty',
          email: 'teacher@gmail.com',
          name: 'ILM Faculty Teacher',
          role: 'TEACHER',
          assignedClass: null,
          status: 'ACTIVE',
          passwordHash: teacherPwHash,
          passwordPlain: '123456789teacher',
        })
        .onConflictDoNothing();
    }

    // 2. Ensure one active Class Admin for each class U1-U6 and expose them in Super Admin Users list
    for (const adminSeed of classAdminSeed) {
      const currentClassAdmins = await db
        .select()
        .from(users)
        .where(
          and(eq(users.role, 'CLASS_ADMIN'), eq(users.assignedClass, adminSeed.classCode))
        );

      for (const adm of currentClassAdmins) {
        if (adm.email !== adminSeed.email && adm.status === 'ACTIVE') {
          await db
            .update(users)
            .set({ status: 'DEACTIVATED', updatedAt: new Date() })
            .where(eq(users.id, adm.id));
        }
      }

      const adminHash = hashPassword(adminSeed.password);
      const existingAdmin = await db
        .select()
        .from(users)
        .where(eq(users.email, adminSeed.email));

      if (existingAdmin.length > 0) {
        await db
          .update(users)
          .set({
            name: adminSeed.name,
            role: 'CLASS_ADMIN',
            assignedClass: adminSeed.classCode,
            status: 'ACTIVE',
            passwordHash: existingAdmin[0].passwordHash || adminHash,
            passwordPlain: existingAdmin[0].passwordPlain || adminSeed.password,
            updatedAt: new Date(),
          })
          .where(eq(users.id, existingAdmin[0].id));
      } else {
        await db
          .insert(users)
          .values({
            uid: `class-admin-${adminSeed.classCode.toLowerCase()}`,
            email: adminSeed.email,
            name: adminSeed.name,
            role: 'CLASS_ADMIN',
            assignedClass: adminSeed.classCode,
            status: 'ACTIVE',
            passwordHash: adminHash,
            passwordPlain: adminSeed.password,
          })
          .onConflictDoNothing();
      }

      await db
        .update(classes)
        .set({ adminEmail: adminSeed.email, updatedAt: new Date() })
        .where(eq(classes.code, adminSeed.classCode));
    }

    // Backfill passwordPlain on any other existing admin user if empty
    const allAdminUsers = await db.select().from(users);
    for (const u of allAdminUsers) {
      if (!u.passwordPlain) {
        const isSuperAdmin =
          u.email === 'nasirhussin12489@gmail.com' ||
          u.email === 'nasirhussain12489@gmail.com' ||
          u.email === 'dilshad1345@gmail.com';
        const defaultPlain = isSuperAdmin
          ? '9934886605dilD@'
          : u.email === 'teacher@gmail.com'
          ? '123456789teacher'
          : classAdminSeed.find((seed) => seed.email === u.email)?.password || 'IlmAdmin#2026';
        await db
          .update(users)
          .set({ passwordPlain: defaultPlain })
          .where(eq(users.id, u.id));
      }
    }

    // 3. Sync exact 8 competition categories & limits (Qirat: 1, Naat: 5, Speech: 5, Table Topic: 5, Aah Counter: 1, Evolution: 5, Marshal: 1, Grammarian: 1)
    const categoryMeta = [
      {
        name: 'Qirat',
        maxParticipantsPerClass: 1,
        description: 'Sacred Quranic recitation with Tajweed and spiritual reverence (Max 1 per class).',
        displayOrder: 1,
      },
      {
        name: 'Naat',
        maxParticipantsPerClass: 5,
        description: 'Classical & contemporary Naat recitation honoring poetic cadence and spiritual devotion (Max 5 per class).',
        displayOrder: 2,
      },
      {
        name: 'Speech',
        maxParticipantsPerClass: 5,
        description: 'Prepared public oratory demonstrating persuasive rhetoric, structure, and leadership (Max 5 per class).',
        displayOrder: 3,
      },
      {
        name: 'Table Topic',
        maxParticipantsPerClass: 5,
        description: 'Impromptu speaking challenge testing quick analytical thinking and vocal poise (Max 5 per class).',
        displayOrder: 4,
      },
      {
        name: 'Aah Counter',
        maxParticipantsPerClass: 1,
        description: 'Precision auditory tracking of filler pauses, verbal crutches, and spoken fluency (Max 1 per class).',
        displayOrder: 5,
      },
      {
        name: 'Evolution',
        maxParticipantsPerClass: 5,
        description: 'Constructive analytical feedback and growth synthesis for fellow class speakers (Max 5 per class).',
        displayOrder: 6,
      },
      {
        name: 'Marshal',
        maxParticipantsPerClass: 1,
        description: 'Session protocol officer maintaining parliamentary order, timing discipline, and decorum (Max 1 per class).',
        displayOrder: 7,
      },
      {
        name: 'Grammarian',
        maxParticipantsPerClass: 1,
        description: 'Linguistic steward introducing the Word of the Week and evaluating rhetorical syntax (Max 1 per class).',
        displayOrder: 8,
      },
    ];

    for (const cat of categoryMeta) {
      const existingCat = await db
        .select()
        .from(competitionCategories)
        .where(eq(competitionCategories.name, cat.name));
      if (existingCat.length > 0) {
        await db
          .update(competitionCategories)
          .set({
            maxParticipantsPerClass: cat.maxParticipantsPerClass,
            description: cat.description,
            displayOrder: cat.displayOrder,
          })
          .where(eq(competitionCategories.id, existingCat[0].id));
      } else {
        await db.insert(competitionCategories).values(cat);
      }
    }

    // 4. Seed initial Students & Class Officers if empty
    const pAyesha = '/assets/images/scholar_portrait_ayesha_1791787508872.jpg';
    const pAhmed = '/assets/images/scholar_portrait_ahmed_1791787523001.jpg';
    const pZainab = '/assets/images/scholar_portrait_zainab_1791787533783.jpg';
    const pFaizan = '/assets/images/scholar_portrait_faizan_1791787544478.jpg';

    const existingStudents = await db.select().from(students);
    if (existingStudents.length === 0) {
      const sampleStudents = [
        { admissionNo: 'ADM-U1-101', fullName: 'Areeba Khan', classCode: 'U1', photoUrl: pAyesha, bio: 'Foundation cohort lead speaker.' },
        { admissionNo: 'ADM-U1-102', fullName: 'Usman Farooq', classCode: 'U1', photoUrl: pAhmed, bio: 'Foundation Naat & Qirat scholar.' },
        { admissionNo: 'ADM-U2-201', fullName: 'Ahmed Khan', classCode: 'U2', photoUrl: pAhmed, bio: 'Keynote speaker on ethical leadership.' },
        { admissionNo: 'ADM-U2-202', fullName: 'Faizan Ali', classCode: 'U2', photoUrl: pFaizan, bio: 'Orator focusing on historical synthesis.' },
        { admissionNo: 'ADM-U2-203', fullName: 'Zainab Fatima', classCode: 'U2', photoUrl: pZainab, bio: 'Lead Naat reciter for U2.' },
        { admissionNo: 'ADM-U3-301', fullName: 'Ayesha Khan', classCode: 'U3', photoUrl: pAyesha, bio: 'Distinguished U3 orator.' },
        { admissionNo: 'ADM-U4-401', fullName: 'Hira Suleman', classCode: 'U4', photoUrl: pZainab, bio: 'Senior Evolution lead in Class U4.' },
        { admissionNo: 'ADM-U5-501', fullName: 'Ahmed Raza', classCode: 'U5', photoUrl: pAhmed, bio: 'Honors Naat laureate in Class U5.' },
        { admissionNo: 'ADM-U6-601', fullName: 'Junaid Ahmed', classCode: 'U6', photoUrl: pFaizan, bio: 'Senior Aah Counter & Capstone Scholar in Class U6.' },
      ];
      for (const st of sampleStudents) {
        await db.insert(students).values({ ...st, createdByEmail: 'nasirhussin12489@gmail.com' }).onConflictDoNothing();
      }
    }

    const existingOfficers = await db.select().from(classOfficers);
    const officerDefaultsByClass: Record<
      string,
      Array<{
        roleTitle: string;
        holderName: string;
        admissionNo: string;
        photoUrl: string;
        responsibilities: string;
      }>
    > = {
      U1: [
        { roleTitle: 'Class Teacher', holderName: 'Prof. Maulana Tariq Jameel', admissionNo: 'FAC-U1-01', photoUrl: pAhmed, responsibilities: 'Senior Class Teacher & Academic Mentor for Class U1 Foundation Cohort.' },
        { roleTitle: 'President', holderName: 'Areeba Khan', admissionNo: 'ADM-U1-101', photoUrl: pAyesha, responsibilities: 'Presides over Class U1 assemblies and executive council.' },
        { roleTitle: 'Vice President of Membership', holderName: 'Usman Farooq', admissionNo: 'ADM-U1-102', photoUrl: pAhmed, responsibilities: 'Coordinates student onboarding and cohort roster.' },
        { roleTitle: 'Vice President of Education', holderName: 'Sara Maryam', admissionNo: 'ADM-U1-103', photoUrl: pZainab, responsibilities: 'Oversees speech curriculum and weekly category assignments.' },
        { roleTitle: 'Vice President of Public Relations', holderName: 'Bilal Raza', admissionNo: 'ADM-U1-104', photoUrl: pFaizan, responsibilities: 'Manages Class U1 posters, announcements, and showcase.' },
        { roleTitle: 'Secretary', holderName: 'Hafsa Noor', admissionNo: 'ADM-U1-105', photoUrl: pAyesha, responsibilities: 'Maintains official session minutes and attendance records.' },
        { roleTitle: 'Treasurer', holderName: 'Zaid Siddiqui', admissionNo: 'ADM-U1-106', photoUrl: pAhmed, responsibilities: 'Stewards class resources, awards, and event logistics.' },
      ],
      U2: [
        { roleTitle: 'Class Teacher', holderName: 'Dr. Salman Nadvi', admissionNo: 'FAC-U2-01', photoUrl: pFaizan, responsibilities: 'Class Teacher & Rhetorical Advisor for Class U2 Emerging Orators.' },
        { roleTitle: 'President', holderName: 'Ahmed Khan', admissionNo: 'ADM-U2-201', photoUrl: pAhmed, responsibilities: 'Presides over Class U2 assemblies and executive leadership.' },
        { roleTitle: 'Vice President of Membership', holderName: 'Faizan Ali', admissionNo: 'ADM-U2-202', photoUrl: pFaizan, responsibilities: 'Leads scholar induction and membership engagement.' },
        { roleTitle: 'Vice President of Education', holderName: 'Zainab Fatima', admissionNo: 'ADM-U2-203', photoUrl: pZainab, responsibilities: 'Directs weekly Speech, Naat, and Evolution tracks.' },
        { roleTitle: 'Vice President of Public Relations', holderName: 'Owais Raza', admissionNo: 'ADM-U2-204', photoUrl: pAhmed, responsibilities: 'Curates Class U2 media feed and competition posters.' },
        { roleTitle: 'Secretary', holderName: 'Ayesha Siddiqua', admissionNo: 'ADM-U2-205', photoUrl: pAyesha, responsibilities: 'Records session evaluations and parliamentary minutes.' },
        { roleTitle: 'Treasurer', holderName: 'Taha Khan', admissionNo: 'ADM-U2-206', photoUrl: pFaizan, responsibilities: 'Manages Class U2 academic materials and logistics.' },
      ],
      U3: [
        { roleTitle: 'Class Teacher', holderName: 'Prof. Bushra Ansar', admissionNo: 'FAC-U3-01', photoUrl: pAyesha, responsibilities: 'Class Teacher & Senior Oratory Guide for Class U3 Intermediate Scholars.' },
        { roleTitle: 'President', holderName: 'Ayesha Khan', admissionNo: 'ADM-U3-301', photoUrl: pAyesha, responsibilities: 'Presides over Class U3 weekly sessions and student council.' },
        { roleTitle: 'Vice President of Membership', holderName: 'Hamza Tariq', admissionNo: 'ADM-U3-302', photoUrl: pAhmed, responsibilities: 'Manages Class U3 student roster and participation.' },
        { roleTitle: 'Vice President of Education', holderName: 'Mariam Noor', admissionNo: 'ADM-U3-303', photoUrl: pZainab, responsibilities: 'Coordinates Class U3 Qirat, Naat, Speech, and Table Topic tracks.' },
        { roleTitle: 'Vice President of Public Relations', holderName: 'Saadullah Baig', admissionNo: 'ADM-U3-304', photoUrl: pFaizan, responsibilities: 'Leads Class U3 poster design and public feed updates.' },
        { roleTitle: 'Secretary', holderName: 'Fatima Zahra', admissionNo: 'ADM-U3-305', photoUrl: pAyesha, responsibilities: 'Maintains Class U3 session records and speaker schedules.' },
        { roleTitle: 'Treasurer', holderName: 'Danish Ali', admissionNo: 'ADM-U3-306', photoUrl: pAhmed, responsibilities: 'Oversees Class U3 academic supplies and event planning.' },
      ],
      U4: [
        { roleTitle: 'Class Teacher', holderName: 'Prof. Imran Qureshi', admissionNo: 'FAC-U4-01', photoUrl: pAhmed, responsibilities: 'Class Teacher & Debate Coach for Class U4 Senior Debaters.' },
        { roleTitle: 'President', holderName: 'Hira Suleman', admissionNo: 'ADM-U4-401', photoUrl: pZainab, responsibilities: 'Presides over Class U4 parliamentary debates and council.' },
        { roleTitle: 'Vice President of Membership', holderName: 'Hassan Javed', admissionNo: 'ADM-U4-402', photoUrl: pFaizan, responsibilities: 'Directs Class U4 cohort membership and scholar mentoring.' },
        { roleTitle: 'Vice President of Education', holderName: 'Khadija Tariq', admissionNo: 'ADM-U4-403', photoUrl: pAyesha, responsibilities: 'Supervises Class U4 Evolution and thematic speech curriculum.' },
        { roleTitle: 'Vice President of Public Relations', holderName: 'Rayyan Siddiqui', admissionNo: 'ADM-U4-404', photoUrl: pAhmed, responsibilities: 'Manages Class U4 competition posters and community feed.' },
        { roleTitle: 'Secretary', holderName: 'Amna Farooq', admissionNo: 'ADM-U4-405', photoUrl: pZainab, responsibilities: 'Compiles Class U4 evaluation logs and weekly minutes.' },
        { roleTitle: 'Treasurer', holderName: 'Waleed Iqbal', admissionNo: 'ADM-U4-406', photoUrl: pFaizan, responsibilities: 'Manages Class U4 awards and competition resources.' },
      ],
      U5: [
        { roleTitle: 'Class Teacher', holderName: 'Dr. Ruqayyah Hashmi', admissionNo: 'FAC-U5-01', photoUrl: pZainab, responsibilities: 'Class Teacher & Honors Fellowship Director for Class U5.' },
        { roleTitle: 'President', holderName: 'Ahmed Raza', admissionNo: 'ADM-U5-501', photoUrl: pAhmed, responsibilities: 'Presides over Class U5 Honors Fellowship executive board.' },
        { roleTitle: 'Vice President of Membership', holderName: 'Yusuf Mahmood', admissionNo: 'ADM-U5-502', photoUrl: pFaizan, responsibilities: 'Coordinates Class U5 scholar induction and peer support.' },
        { roleTitle: 'Vice President of Education', holderName: 'Sumayyah Aziz', admissionNo: 'ADM-U5-503', photoUrl: pAyesha, responsibilities: 'Leads Class U5 advanced speech synthesis and Naat programs.' },
        { roleTitle: 'Vice President of Public Relations', holderName: 'Haris Zubair', admissionNo: 'ADM-U5-504', photoUrl: pAhmed, responsibilities: 'Directs Class U5 showcase posters and feed publications.' },
        { roleTitle: 'Secretary', holderName: 'Iqra Mansoor', admissionNo: 'ADM-U5-505', photoUrl: pZainab, responsibilities: 'Maintains Class U5 fellowship documentation and agendas.' },
        { roleTitle: 'Treasurer', holderName: 'Noman Sheikh', admissionNo: 'ADM-U5-506', photoUrl: pFaizan, responsibilities: 'Stewards Class U5 honors fellowship logistics.' },
      ],
      U6: [
        { roleTitle: 'Class Teacher', holderName: 'Prof. Allama Khalid Masood', admissionNo: 'FAC-U6-01', photoUrl: pFaizan, responsibilities: 'Senior Class Teacher & Master Laureates Advisor for Class U6.' },
        { roleTitle: 'President', holderName: 'Junaid Ahmed', admissionNo: 'ADM-U6-601', photoUrl: pFaizan, responsibilities: 'Presides over Class U6 Master Laureates executive assembly.' },
        { roleTitle: 'Vice President of Membership', holderName: 'Talha Bin Zubair', admissionNo: 'ADM-U6-602', photoUrl: pAhmed, responsibilities: 'Oversees Class U6 senior cohort roster and leadership.' },
        { roleTitle: 'Vice President of Education', holderName: 'Mahira Sultan', admissionNo: 'ADM-U6-603', photoUrl: pAyesha, responsibilities: 'Directs Class U6 capstone speeches and evaluation standards.' },
        { roleTitle: 'Vice President of Public Relations', holderName: 'Huzaifa Anwar', admissionNo: 'ADM-U6-604', photoUrl: pFaizan, responsibilities: 'Curates Class U6 official posters and public gallery.' },
        { roleTitle: 'Secretary', holderName: 'Noor-ul-Ain', admissionNo: 'ADM-U6-605', photoUrl: pZainab, responsibilities: 'Keeps official Class U6 parliamentary and competition records.' },
        { roleTitle: 'Treasurer', holderName: 'Arsalan Shah', admissionNo: 'ADM-U6-606', photoUrl: pAhmed, responsibilities: 'Manages Class U6 graduation showcase and awards.' },
      ],
    };

    for (const [clsCode, templates] of safeObjectEntries(officerDefaultsByClass)) {
      if (!Array.isArray(templates)) continue;

      for (const tpl of templates) {
        const match = existingOfficers.find(
          (o) =>
            o.classCode === clsCode &&
            o.roleTitle.trim().toLowerCase() === tpl.roleTitle.trim().toLowerCase()
        );
        if (!match) {
          await db.insert(classOfficers).values({
            classCode: clsCode,
            roleTitle: tpl.roleTitle,
            holderName: tpl.holderName,
            admissionNo: tpl.admissionNo,
            photoUrl: tpl.photoUrl,
            responsibilities: tpl.responsibilities,
            updatedByEmail: 'nasirhussin12489@gmail.com',
          });
        } else if (!match.holderName || !match.photoUrl) {
          await db
            .update(classOfficers)
            .set({
              holderName: match.holderName || tpl.holderName,
              photoUrl: match.photoUrl || tpl.photoUrl,
              admissionNo: match.admissionNo || tpl.admissionNo,
              responsibilities: match.responsibilities || tpl.responsibilities,
              updatedAt: new Date(),
            })
            .where(eq(classOfficers.id, match.id));
        }
      }
    }

    // Seed initial approved feed posts if none exist so the Home Page Feed section is populated out of the box
    const existingFeed = await db.select().from(feedPosts);
    if (existingFeed.length === 0) {
      const sampleFeed = [
        {
          classCode: 'U1',
          title: 'Class U1 Weekly Competition Lineup & Highlights',
          caption: 'Our Class U1 scholars delivered inspiring Qirat, Naat, Speech, and Table Topic performances in this week’s ILM stage session.',
          mediaUrl: pAyesha,
          mediaType: 'POSTER',
          status: 'APPROVED',
          submittedByEmail: 'nasirhussin12489@gmail.com',
          submittedByName: 'Class U1 Official',
        },
        {
          classCode: 'U2',
          title: 'Class U2 Emerging Orators Stage Session',
          caption: 'Snapshots and official poster announcement from the Class U2 Speech, Naat, and Evolution evaluation session.',
          mediaUrl: pAhmed,
          mediaType: 'PHOTO',
          status: 'APPROVED',
          submittedByEmail: 'nasirhussin12489@gmail.com',
          submittedByName: 'Class U2 Official',
        },
        {
          classCode: 'U3',
          title: 'Class U3 Intermediate Scholars Oratory Showcase',
          caption: 'Celebrating excellence in classical Naat recitation and impromptu Table Topics across Class U3.',
          mediaUrl: pZainab,
          mediaType: 'ANNOUNCEMENT',
          status: 'APPROVED',
          submittedByEmail: 'nasirhussin12489@gmail.com',
          submittedByName: 'Class U3 Official',
        },
      ];
      for (const fp of sampleFeed) {
        await db.insert(feedPosts).values(fp);
      }
    }

    // 5. Ensure each class (U1-U6) has its unified 1-page Master Class Poster combining all categories
    for (const clsCode of VALID_CLASSES) {
      await regeneratePosterForClassCategory(clsCode, 'All Categories');
    }

    // 6. Ensure default ImgBB API key is initialized in platformSettings if not set
    const existingImgbb = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.settingKey, 'imgbbApiKey'))
      .limit(1);
    if (!existingImgbb.length || !existingImgbb[0].settingValue?.trim()) {
      await db
        .insert(platformSettings)
        .values({
          settingKey: 'imgbbApiKey',
          settingValue: '7443bf294f338b5a0c690e7de1fc2acd',
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: platformSettings.settingKey,
          set: {
            settingValue: '7443bf294f338b5a0c690e7de1fc2acd',
            updatedAt: new Date(),
          },
        });
    }

    credentialsSynced = true;
  } catch (error) {
    console.error('Error syncing requested admin credentials:', error);
  }
}

export async function ensureInitialSeedData() {
  if (!isSqlConfigured()) {
    return;
  }

  try {
    await ensureRequestedAdminCredentials();
  } catch (error) {
    console.warn('Database seed credential sync skipped because SQL is unavailable:', error);
    return;
  }

  if (!db) {
    console.warn('Database is unavailable; skipping ILM seed sync.');
    return;
  }

  if (seedCompleted || isSeeding) return;
  isSeeding = true;
  try {
    const existingClasses = await db.select().from(classes);
    if (existingClasses.length > 0) {
      seedCompleted = true;
      isSeeding = false;
      return;
    }

    // Seed classes (U1 to U6) if brand new DB
    const classDefs = [
      {
        code: 'U1',
        name: 'Class U1 — Foundation Cohort',
        description: 'Primary oratorical foundation, phonetic clarity, and introductory Naat & Speech.',
        adminEmail: 'admin@gmail.com',
      },
      {
        code: 'U2',
        name: 'Class U2 — Emerging Orators',
        description: 'Structured public speaking, classical Naat delivery, and peer Evolution sessions.',
        adminEmail: 'u2.admin@ilm.edu.pk',
      },
      {
        code: 'U3',
        name: 'Class U3 — Intermediate Scholars',
        description: 'Rhetorical composition, analytical Evolution, and parliamentary session leadership.',
        adminEmail: 'u3.admin@ilm.edu.pk',
      },
      {
        code: 'U4',
        name: 'Class U4 — Senior Debaters',
        description: 'Advanced thematic speeches, grammatical mastery, and executive session moderation.',
        adminEmail: 'u4.admin@ilm.edu.pk',
      },
      {
        code: 'U5',
        name: 'Class U5 — Honors Fellowship',
        description: 'Distinguished Naat recitation, keynote speech synthesis, and critical evaluation.',
        adminEmail: 'u5.admin@ilm.edu.pk',
      },
      {
        code: 'U6',
        name: 'Class U6 — Master Laureates',
        description: 'Capstone leadership cohort preparing senior scholars for institutional excellence.',
        adminEmail: 'u6.admin@ilm.edu.pk',
      },
    ];

    for (const cls of classDefs) {
      await db.insert(classes).values(cls).onConflictDoNothing();
    }

    seedCompleted = true;
  } catch (error) {
    console.error('Error seeding initial ILM database records:', error);
  } finally {
    isSeeding = false;
  }
}
