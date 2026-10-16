import type {
  CategoryRecord,
  ClassRecord,
  FeedPostRecord,
  LibraryResourceRecord,
  PosterRecord,
  PublicBootstrapData,
  WeeklyResultRecord,
} from '../types.ts';
import { buildIlmPosterSvg } from './posterSvg.ts';

export let OFFLINE_ADMIN_USERS: Array<{
  id: number;
  uid: string;
  email: string;
  name: string;
  role: string;
  assignedClass: string | null;
  status: string;
  passwordPlain: string;
}> = [
  {
    id: 1,
    uid: 'superadmin-owner-uid',
    email: 'nasirhussain12489@gmail.com',
    name: 'Nasir Hussain (Super Admin)',
    role: 'SUPER_ADMIN',
    assignedClass: null,
    status: 'ACTIVE',
    passwordPlain: '9934886605dilD@',
  },
  {
    id: 2,
    uid: 'superadmin-nasir-1',
    email: 'nasirhussin12489@gmail.com',
    name: 'Nasir Hussain (Super Admin)',
    role: 'SUPER_ADMIN',
    assignedClass: null,
    status: 'ACTIVE',
    passwordPlain: '9934886605dilD@',
  },
  {
    id: 3,
    uid: 'superadmin-dilshad',
    email: 'dilshad1345@gmail.com',
    name: 'Dilshad (Super Admin)',
    role: 'SUPER_ADMIN',
    assignedClass: null,
    status: 'ACTIVE',
    passwordPlain: '9934886605dilD@',
  },
  {
    id: 4,
    uid: 'teacher-primary-faculty',
    email: 'teacher@gmail.com',
    name: 'ILM Faculty Teacher',
    role: 'TEACHER',
    assignedClass: null,
    status: 'ACTIVE',
    passwordPlain: '123456789teacher',
  },
  {
    id: 5,
    uid: 'class-admin-u1-legacy',
    email: 'admin@gmail.com',
    name: 'U1 Class Admin',
    role: 'CLASS_ADMIN',
    assignedClass: 'U1',
    status: 'ACTIVE',
    passwordPlain: '123456789admin',
  },
  {
    id: 6,
    uid: 'class-admin-u1',
    email: 'u1admin@gmail.com',
    name: 'U1 Class Admin',
    role: 'CLASS_ADMIN',
    assignedClass: 'U1',
    status: 'ACTIVE',
    passwordPlain: 'u1admin@2026',
  },
  {
    id: 7,
    uid: 'class-admin-u2',
    email: 'u2admin@gmail.com',
    name: 'U2 Class Admin',
    role: 'CLASS_ADMIN',
    assignedClass: 'U2',
    status: 'ACTIVE',
    passwordPlain: 'u2admin@2026',
  },
  {
    id: 8,
    uid: 'class-admin-u3',
    email: 'u3admin@gmail.com',
    name: 'U3 Class Admin',
    role: 'CLASS_ADMIN',
    assignedClass: 'U3',
    status: 'ACTIVE',
    passwordPlain: 'u3admin@2026',
  },
  {
    id: 9,
    uid: 'class-admin-u4',
    email: 'u4admin@gmail.com',
    name: 'U4 Class Admin',
    role: 'CLASS_ADMIN',
    assignedClass: 'U4',
    status: 'ACTIVE',
    passwordPlain: 'u4admin@2026',
  },
  {
    id: 10,
    uid: 'class-admin-u5',
    email: 'u5admin@gmail.com',
    name: 'U5 Class Admin',
    role: 'CLASS_ADMIN',
    assignedClass: 'U5',
    status: 'ACTIVE',
    passwordPlain: 'u5admin@2026',
  },
  {
    id: 11,
    uid: 'class-admin-u6',
    email: 'u6admin@gmail.com',
    name: 'U6 Class Admin',
    role: 'CLASS_ADMIN',
    assignedClass: 'U6',
    status: 'ACTIVE',
    passwordPlain: 'u6admin@2026',
  },
];

export function getOfflineAdminUser(email: string) {
  const normalized = String(email || '').trim().toLowerCase();
  return (
    OFFLINE_ADMIN_USERS.find(
      (user) => user.email.toLowerCase() === normalized
    ) || null
  );
}

export function upsertOfflineAdminUser(input: {
  id?: number;
  uid?: string;
  email: string;
  name: string;
  role: string;
  assignedClass: string | null;
  status?: string;
  passwordPlain?: string;
}) {
  const normalizedEmail = String(input.email || '').trim().toLowerCase();
  const existingIndex = OFFLINE_ADMIN_USERS.findIndex(
    (user) => user.email.toLowerCase() === normalizedEmail
  );

  const nextUser = {
    id:
      input.id ??
      (existingIndex >= 0
        ? OFFLINE_ADMIN_USERS[existingIndex].id
        : OFFLINE_ADMIN_USERS.reduce((max, user) => Math.max(max, user.id), 0) + 1),
    uid:
      input.uid ??
      (existingIndex >= 0 ? OFFLINE_ADMIN_USERS[existingIndex].uid : `offline-admin-${Date.now()}`),
    email: normalizedEmail,
    name: String(input.name || '').trim() || 'Offline Admin',
    role: input.role || 'CLASS_ADMIN',
    assignedClass: input.assignedClass ?? null,
    status: input.status || 'ACTIVE',
    passwordPlain: String(input.passwordPlain || 'IlmAdmin#2026').trim(),
  };

  if (existingIndex >= 0) {
    OFFLINE_ADMIN_USERS[existingIndex] = nextUser;
    return nextUser;
  }

  OFFLINE_ADMIN_USERS.push(nextUser);
  return nextUser;
}

export function removeOfflineAdminUser(id: number) {
  const index = OFFLINE_ADMIN_USERS.findIndex((user) => user.id === id);
  if (index < 0) return false;
  OFFLINE_ADMIN_USERS.splice(index, 1);
  return true;
}

export function validateAdminDelete(
  users: Array<{ id: number; email: string; role: string; assignedClass?: string | null; status?: string }>,
  targetUserId: number,
  context: { currentUserId: number; currentUserRole: string }
) {
  const target = users.find((user) => user.id === targetUserId);
  if (!target) {
    throw new Error('User account not found.');
  }

  if (targetUserId === context.currentUserId) {
    throw new Error('You cannot delete your own active Super Admin account.');
  }

  if (target.role === 'SUPER_ADMIN') {
    const activeSuperAdmins = users.filter(
      (user) => user.role === 'SUPER_ADMIN' && user.status !== 'DEACTIVATED'
    );
    if (activeSuperAdmins.length <= 1) {
      throw new Error('At least one active Super Admin must remain.');
    }
  }

  if (target.role === 'CLASS_ADMIN' && target.assignedClass) {
    const activeClassAdmins = users.filter(
      (user) =>
        user.role === 'CLASS_ADMIN' &&
        user.assignedClass === target.assignedClass &&
        user.status !== 'DEACTIVATED' &&
        user.id !== targetUserId
    );

    if (activeClassAdmins.length === 0) {
      throw new Error(
        `This is the last active Class Admin for class ${target.assignedClass}. Delete is blocked to keep at least one admin per class.`
      );
    }
  }

  return true;
}

export function isSqlConfigured(): boolean {
  return Boolean(
    process.env.SQL_HOST &&
      process.env.SQL_DB_NAME &&
      process.env.SQL_USER &&
      process.env.SQL_PASSWORD
  );
}

export function hasConfiguredDatabase(): boolean {
  return isSqlConfigured() || Boolean(
    process.env.SUPABASE_URL &&
      (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)
  );
}

const FALLBACK_CLASS_SAMPLE_PARTICIPANTS: Record<string, Array<{ fullName: string; categoryName: string; photoUrl: string }>> = {
  U1: [
    { fullName: 'Ayesha Khan', categoryName: 'Qirat', photoUrl: '/assets/images/scholar_portrait_ayesha_1791787508872.jpg' },
    { fullName: 'Hafsa Malik', categoryName: 'Naat', photoUrl: '/assets/images/scholar_portrait_zainab_1791787533783.jpg' },
    { fullName: 'Zainab Ali', categoryName: 'Speech', photoUrl: '/assets/images/scholar_portrait_zainab_1791787533783.jpg' },
    { fullName: 'Ahmed Hassan', categoryName: 'Table Topic', photoUrl: '/assets/images/scholar_portrait_ahmed_1791787523001.jpg' },
    { fullName: 'Faizan Raza', categoryName: 'Marshal', photoUrl: '/assets/images/scholar_portrait_faizan_1791787544478.jpg' },
  ],
  U2: [
    { fullName: 'Maryam Noor', categoryName: 'Naat', photoUrl: '/assets/images/scholar_portrait_ayesha_1791787508872.jpg' },
    { fullName: 'Bilal Saeed', categoryName: 'Speech', photoUrl: '/assets/images/scholar_portrait_ahmed_1791787523001.jpg' },
    { fullName: 'Sara Ahmed', categoryName: 'Table Topic', photoUrl: '/assets/images/scholar_portrait_zainab_1791787533783.jpg' },
    { fullName: 'Hamza Tariq', categoryName: 'Evolution', photoUrl: '/assets/images/scholar_portrait_faizan_1791787544478.jpg' },
    { fullName: 'Nadia Iqbal', categoryName: 'Grammarian', photoUrl: '/assets/images/scholar_portrait_ayesha_1791787508872.jpg' },
  ],
  U3: [
    { fullName: 'Lubna Ahsan', categoryName: 'Naat', photoUrl: '/assets/images/scholar_portrait_ayesha_1791787508872.jpg' },
    { fullName: 'Omer Shah', categoryName: 'Speech', photoUrl: '/assets/images/scholar_portrait_ahmed_1791787523001.jpg' },
    { fullName: 'Noor Fatima', categoryName: 'Table Topic', photoUrl: '/assets/images/scholar_portrait_zainab_1791787533783.jpg' },
    { fullName: 'Ehsan Bukhari', categoryName: 'Aah Counter', photoUrl: '/assets/images/scholar_portrait_faizan_1791787544478.jpg' },
    { fullName: 'Sana Yousaf', categoryName: 'Evolution', photoUrl: '/assets/images/scholar_portrait_ayesha_1791787508872.jpg' },
  ],
  U4: [
    { fullName: 'Rida Hassan', categoryName: 'Qirat', photoUrl: '/assets/images/scholar_portrait_ayesha_1791787508872.jpg' },
    { fullName: 'Usman Rehman', categoryName: 'Naat', photoUrl: '/assets/images/scholar_portrait_ahmed_1791787523001.jpg' },
    { fullName: 'Zoya Ilyas', categoryName: 'Speech', photoUrl: '/assets/images/scholar_portrait_zainab_1791787533783.jpg' },
    { fullName: 'Farhan Qureshi', categoryName: 'Table Topic', photoUrl: '/assets/images/scholar_portrait_faizan_1791787544478.jpg' },
    { fullName: 'Mariam Siddique', categoryName: 'Marshal', photoUrl: '/assets/images/scholar_portrait_ayesha_1791787508872.jpg' },
  ],
  U5: [
    { fullName: 'Anum Akhtar', categoryName: 'Naat', photoUrl: '/assets/images/scholar_portrait_ayesha_1791787508872.jpg' },
    { fullName: 'Aliyan Rafiq', categoryName: 'Speech', photoUrl: '/assets/images/scholar_portrait_ahmed_1791787523001.jpg' },
    { fullName: 'Hira Javed', categoryName: 'Table Topic', photoUrl: '/assets/images/scholar_portrait_zainab_1791787533783.jpg' },
    { fullName: 'Talha Mehmood', categoryName: 'Evolution', photoUrl: '/assets/images/scholar_portrait_faizan_1791787544478.jpg' },
    { fullName: 'Kashaf Naveed', categoryName: 'Grammarian', photoUrl: '/assets/images/scholar_portrait_ayesha_1791787508872.jpg' },
  ],
  U6: [
    { fullName: 'Maham Shahid', categoryName: 'Qirat', photoUrl: '/assets/images/scholar_portrait_ayesha_1791787508872.jpg' },
    { fullName: 'Yasir Nazir', categoryName: 'Naat', photoUrl: '/assets/images/scholar_portrait_ahmed_1791787523001.jpg' },
    { fullName: 'Sadia Qamar', categoryName: 'Speech', photoUrl: '/assets/images/scholar_portrait_zainab_1791787533783.jpg' },
    { fullName: 'Abdullah Khan', categoryName: 'Table Topic', photoUrl: '/assets/images/scholar_portrait_faizan_1791787544478.jpg' },
    { fullName: 'Sumaira Riaz', categoryName: 'Aah Counter', photoUrl: '/assets/images/scholar_portrait_ayesha_1791787508872.jpg' },
  ],
};

export let OFFLINE_PARTICIPANTS: Array<{
  id: number;
  admissionNo: string | null;
  fullName: string;
  photoUrl: string;
  classCode: string;
  categoryName: string;
  ownTopic: string | null;
  shortDescription: string | null;
  publicationStatus: string;
  createdByEmail?: string | null;
  createdAt: string;
  updatedAt: string;
}> = [];

export let OFFLINE_POSTERS: PosterRecord[] = [];
export let OFFLINE_WEEKLY_RESULTS: WeeklyResultRecord[] = [];
export let OFFLINE_LIBRARY_RESOURCES: LibraryResourceRecord[] = [
  {
    id: 1,
    title: 'ILM Leadership Notes',
    description: 'A quick reference guide for class leadership principles, discipline, and communication habits.',
    author: 'ILM Team',
    category: 'Notes',
    libraryScope: 'COMMON',
    fileUrl: '/uploads/demo-ilm-leadership-notes.pdf',
    fileType: 'PDF',
    fileSize: '1.4 MB',
    contentPreview: 'Leadership begins with clarity, consistency, and service.',
    publicationStatus: 'PUBLISHED',
    uploadedByEmail: 'admin@ilm.edu.pk',
    createdAt: new Date().toISOString(),
  },
  {
    id: 2,
    title: 'Naat Delivery Guide',
    description: 'A practical booklet focused on expression, timing, and respectful recitation for Naat performances.',
    author: 'ILM Faculty',
    category: 'Books',
    libraryScope: 'COMMON',
    fileUrl: '/uploads/demo-naat-delivery-guide.pdf',
    fileType: 'PDF',
    fileSize: '2.1 MB',
    contentPreview: 'Maintain calm posture, controlled breath, and heartfelt expression.',
    publicationStatus: 'PUBLISHED',
    uploadedByEmail: 'admin@ilm.edu.pk',
    createdAt: new Date().toISOString(),
  },
  {
    id: 3,
    title: 'Speech Practice Workbook',
    description: 'A workbook for building strong arguments, disciplined openings, and confident closing statements.',
    author: 'ILM Team',
    category: 'Research Papers',
    libraryScope: 'U1',
    fileUrl: '/uploads/demo-speech-practice-workbook.pdf',
    fileType: 'PDF',
    fileSize: '1.8 MB',
    contentPreview: 'Structure your speech around purpose, proof, and audience connection.',
    publicationStatus: 'HIDDEN',
    uploadedByEmail: 'admin@ilm.edu.pk',
    createdAt: new Date().toISOString(),
  },
];
export let OFFLINE_FEED_POSTS: FeedPostRecord[] = [];

export function upsertOfflineWeeklyResult(input: {
  id?: number;
  resultCategory: 'Best Speaker' | 'Best Naat';
  winnerName: string;
  winnerPhotoUrl: string;
  winnerClass: string;
  weekLabel: string;
  resultDate: string;
  remarks?: string | null;
  publicationStatus?: string;
  publishedByEmail?: string | null;
}) {
  const normalizedClass = String(input.winnerClass || 'U1').toUpperCase();
  const normalizedName = String(input.winnerName || '').trim();
  if (!normalizedName) {
    throw new Error('Winner name is required.');
  }

  const index = OFFLINE_WEEKLY_RESULTS.findIndex((item) => item.id === input.id);
  const now = new Date().toISOString();
  const record: WeeklyResultRecord = {
    id: input.id ?? OFFLINE_WEEKLY_RESULTS.reduce((max, item) => Math.max(max, item.id), 0) + 1,
    resultCategory: input.resultCategory,
    winnerName: normalizedName,
    winnerPhotoUrl: input.winnerPhotoUrl,
    winnerClass: normalizedClass as any,
    weekLabel: input.weekLabel,
    resultDate: input.resultDate,
    remarks: input.remarks ?? null,
    publicationStatus: input.publicationStatus ?? 'PUBLISHED',
    createdAt: now,
  };

  if (index >= 0) {
    OFFLINE_WEEKLY_RESULTS[index] = { ...OFFLINE_WEEKLY_RESULTS[index], ...record };
    return OFFLINE_WEEKLY_RESULTS[index];
  }

  OFFLINE_WEEKLY_RESULTS.push(record);
  return record;
}

export function removeOfflineWeeklyResult(id: number) {
  const before = OFFLINE_WEEKLY_RESULTS.length;
  OFFLINE_WEEKLY_RESULTS = OFFLINE_WEEKLY_RESULTS.filter((item) => item.id !== id);
  return before !== OFFLINE_WEEKLY_RESULTS.length;
}

export function upsertOfflineLibraryResource(input: {
  id?: number;
  title: string;
  description: string;
  author?: string;
  category: string;
  libraryScope: 'COMMON' | string;
  fileUrl: string;
  fileType?: string;
  fileSize?: string;
  contentPreview?: string | null;
  publicationStatus?: string;
  uploadedByEmail?: string | null;
}) {
  const normalizedTitle = String(input.title || '').trim();
  if (!normalizedTitle) {
    throw new Error('Resource title is required.');
  }

  const nextId =
    input.id ??
    OFFLINE_LIBRARY_RESOURCES.reduce((max, item) => Math.max(max, item.id), 0) + 1;

  const record: LibraryResourceRecord = {
    id: nextId,
    title: normalizedTitle,
    description: String(input.description || '').trim() || 'No description provided.',
    author: String(input.author || 'ILM Team').trim(),
    category: (input.category || 'Books') as any,
    libraryScope: String(input.libraryScope || 'COMMON') as 'COMMON' | any,
    fileUrl: String(input.fileUrl || '').trim(),
    fileType: String(input.fileType || 'PDF').toUpperCase(),
    fileSize: String(input.fileSize || '1.0 MB'),
    contentPreview: input.contentPreview ?? null,
    publicationStatus: input.publicationStatus ?? 'PUBLISHED',
    uploadedByEmail: input.uploadedByEmail ?? null,
    createdAt: new Date().toISOString(),
  };

  const existingIndex = OFFLINE_LIBRARY_RESOURCES.findIndex((item) => item.id === nextId);
  if (existingIndex >= 0) {
    OFFLINE_LIBRARY_RESOURCES[existingIndex] = {
      ...OFFLINE_LIBRARY_RESOURCES[existingIndex],
      ...record,
    };
    return OFFLINE_LIBRARY_RESOURCES[existingIndex];
  }

  OFFLINE_LIBRARY_RESOURCES.push(record);
  return record;
}

export function removeOfflineLibraryResource(id: number) {
  const before = OFFLINE_LIBRARY_RESOURCES.length;
  OFFLINE_LIBRARY_RESOURCES = OFFLINE_LIBRARY_RESOURCES.filter((item) => item.id !== id);
  return before !== OFFLINE_LIBRARY_RESOURCES.length;
}

export function upsertOfflineFeedPost(input: {
  id?: number;
  classCode: string;
  title: string;
  caption: string;
  mediaUrl: string;
  mediaType?: 'PHOTO' | 'POSTER' | 'ANNOUNCEMENT';
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason?: string | null;
  submittedByEmail?: string;
  submittedByName?: string;
  reviewedByEmail?: string | null;
  reviewedAt?: string | null;
}) {
  const normalizedClass = String(input.classCode || 'U1').toUpperCase();
  const normalizedTitle = String(input.title || '').trim();
  const normalizedCaption = String(input.caption || '').trim();
  const normalizedMediaUrl = String(input.mediaUrl || '').trim();
  const normalizedName = String(input.submittedByName || 'ILM Admin').trim() || 'ILM Admin';

  if (!normalizedTitle || !normalizedCaption || !normalizedMediaUrl) {
    throw new Error('Feed post title, caption, and media URL are required.');
  }

  const nextId = input.id ?? OFFLINE_FEED_POSTS.reduce((max, item) => Math.max(max, item.id), 0) + 1;
  const now = new Date().toISOString();
  const record: FeedPostRecord = {
    id: nextId,
    classCode: normalizedClass as FeedPostRecord['classCode'],
    title: normalizedTitle,
    caption: normalizedCaption,
    mediaUrl: normalizedMediaUrl,
    mediaType: (input.mediaType || 'PHOTO') as FeedPostRecord['mediaType'],
    status: (input.status || 'APPROVED') as FeedPostRecord['status'],
    rejectionReason: input.rejectionReason ?? null,
    submittedByEmail: input.submittedByEmail ?? null,
    submittedByName: normalizedName,
    reviewedByEmail: input.reviewedByEmail ?? null,
    reviewedAt: input.reviewedAt ?? null,
    createdAt: now,
  };

  const index = OFFLINE_FEED_POSTS.findIndex((item) => item.id === nextId);
  if (index >= 0) {
    OFFLINE_FEED_POSTS[index] = { ...OFFLINE_FEED_POSTS[index], ...record };
    return OFFLINE_FEED_POSTS[index];
  }

  OFFLINE_FEED_POSTS.push(record);
  return record;
}

export function removeOfflineFeedPost(id: number) {
  const before = OFFLINE_FEED_POSTS.length;
  OFFLINE_FEED_POSTS = OFFLINE_FEED_POSTS.filter((item) => item.id !== id);
  return before !== OFFLINE_FEED_POSTS.length;
}

export function upsertOfflineParticipant(input: {
  id?: number;
  admissionNo?: string | null;
  fullName: string;
  photoUrl: string;
  classCode: string;
  categoryName: string;
  ownTopic?: string | null;
  shortDescription?: string | null;
  publicationStatus?: string;
  createdByEmail?: string | null;
}) {
  const normalizedClass = String(input.classCode || 'U1').toUpperCase();
  const normalizedName = String(input.fullName || '').trim();
  if (!normalizedName) {
    throw new Error('Participant full name is required.');
  }

  const index = OFFLINE_PARTICIPANTS.findIndex((item) => item.id === input.id);
  const now = new Date().toISOString();
  const record = {
    id: input.id ?? OFFLINE_PARTICIPANTS.reduce((max, item) => Math.max(max, item.id), 0) + 1,
    admissionNo: input.admissionNo ?? null,
    fullName: normalizedName,
    photoUrl: input.photoUrl,
    classCode: normalizedClass,
    categoryName: input.categoryName,
    ownTopic: input.ownTopic ?? null,
    shortDescription: input.shortDescription ?? null,
    publicationStatus: input.publicationStatus ?? 'PUBLISHED',
    createdByEmail: input.createdByEmail ?? null,
    createdAt: now,
    updatedAt: now,
  };

  if (index >= 0) {
    OFFLINE_PARTICIPANTS[index] = { ...OFFLINE_PARTICIPANTS[index], ...record, updatedAt: now };
    return OFFLINE_PARTICIPANTS[index];
  }

  OFFLINE_PARTICIPANTS.push(record);
  return record;
}

export function removeOfflineParticipant(id: number) {
  const before = OFFLINE_PARTICIPANTS.length;
  OFFLINE_PARTICIPANTS = OFFLINE_PARTICIPANTS.filter((item) => item.id !== id);
  return before !== OFFLINE_PARTICIPANTS.length;
}

export function getOfflineParticipantsForClass(classCode: string) {
  return OFFLINE_PARTICIPANTS.filter(
    (item) => item.classCode === String(classCode || '').toUpperCase()
  );
}

export function upsertOfflinePoster(poster: PosterRecord) {
  const index = OFFLINE_POSTERS.findIndex((item) => item.classCode === poster.classCode);
  const normalizedPoster = {
    ...poster,
    updatedAt: poster.updatedAt || new Date().toISOString(),
    createdAt: poster.createdAt || new Date().toISOString(),
  };

  if (index >= 0) {
    OFFLINE_POSTERS[index] = normalizedPoster;
    return normalizedPoster;
  }

  OFFLINE_POSTERS.push(normalizedPoster);
  return normalizedPoster;
}

export function buildFallbackPosterForClass(
  classCode: string,
  explicitParticipants?: Array<{
    id?: number;
    admissionNo?: string | null;
    fullName: string;
    photoUrl: string;
    classCode?: string;
    categoryName: string;
    ownTopic?: string | null;
  }>
): PosterRecord {
  const normalizedClass = String(classCode || 'U1').toUpperCase();
  const participantSource = explicitParticipants && explicitParticipants.length > 0
    ? explicitParticipants
    : (FALLBACK_CLASS_SAMPLE_PARTICIPANTS[normalizedClass] || FALLBACK_CLASS_SAMPLE_PARTICIPANTS.U1).map((person, index) => ({
        id: index + 1,
        admissionNo: `ADM-${normalizedClass}-${index + 1}`,
        fullName: person.fullName,
        photoUrl: person.photoUrl,
        classCode: normalizedClass,
        categoryName: person.categoryName,
        ownTopic: null,
      }));

  const classTitle = `${normalizedClass} Class Competition Lineup`;
  const classSubtitle = `Unified Class Poster · ${participantSource.length} / 24 Registered Candidates Across Qirat, Naat, Speech, Table Topic, Evolution, Aah Counter, Marshal & Grammarian`;
  const svg = buildIlmPosterSvg({
    classCode: normalizedClass,
    categoryName: 'All Categories',
    title: classTitle,
    subtitle: classSubtitle,
    participants: participantSource.map((person, index) => ({
      id: person.id ?? index + 1,
      admissionNo: person.admissionNo ?? `ADM-${normalizedClass}-${index + 1}`,
      fullName: person.fullName,
      photoUrl: person.photoUrl,
      classCode: normalizedClass,
      categoryName: person.categoryName,
      ownTopic: person.ownTopic ?? null,
    })),
  });

  const poster: PosterRecord = {
    id: 10000 + ['U1','U2','U3','U4','U5','U6'].indexOf(normalizedClass) + 1,
    classCode: normalizedClass as any,
    categoryName: 'All Categories',
    title: classTitle,
    subtitle: classSubtitle,
    posterImageUrl: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    participantsSnapshot: JSON.stringify(participantSource.map((person, index) => ({
      id: person.id ?? index + 1,
      admissionNo: person.admissionNo ?? `ADM-${normalizedClass}-${index + 1}`,
      fullName: person.fullName,
      photoUrl: person.photoUrl,
      classCode: normalizedClass,
      categoryName: person.categoryName,
      ownTopic: person.ownTopic ?? null,
    }))),
    participantCount: participantSource.length,
    generationStatus: 'COMPLETED',
    generationError: null,
    publicationStatus: 'PUBLISHED',
    isFeatured: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return poster;
}

export function createFallbackBootstrapData(): PublicBootstrapData {
  const classes: ClassRecord[] = [
    { id: 1, code: 'U1', name: 'Class U1 — Foundation Cohort', description: 'Foundation cohort for new learners.' },
    { id: 2, code: 'U2', name: 'Class U2 — Emerging Orators', description: 'Developing confident public speakers.' },
    { id: 3, code: 'U3', name: 'Class U3 — Intermediate Scholars', description: 'Intermediate skill building and evaluation.' },
    { id: 4, code: 'U4', name: 'Class U4 — Senior Debaters', description: 'Advanced debate and presentation skills.' },
    { id: 5, code: 'U5', name: 'Class U5 — Honors Fellowship', description: 'Leadership and advanced competition training.' },
    { id: 6, code: 'U6', name: 'Class U6 — Master Laureates', description: 'Capstone leadership and excellence.' },
  ];

  const categories: CategoryRecord[] = [
    { id: 1, name: 'Qirat', maxParticipantsPerClass: 1, description: 'Recitation and vocal excellence.', displayOrder: 1 },
    { id: 2, name: 'Naat', maxParticipantsPerClass: 6, description: 'Naat recitation and expression.', displayOrder: 2 },
    { id: 3, name: 'Speech', maxParticipantsPerClass: 5, description: 'Prepared speech and delivery.', displayOrder: 3 },
    { id: 4, name: 'Table Topic', maxParticipantsPerClass: 5, description: 'Impromptu speaking and strategy.', displayOrder: 4 },
    { id: 5, name: 'Aah Counter', maxParticipantsPerClass: 1, description: 'Evaluation and analysis.', displayOrder: 5 },
    { id: 6, name: 'Evolution', maxParticipantsPerClass: 5, description: 'Growth and progress tracking.', displayOrder: 6 },
    { id: 7, name: 'Marshal', maxParticipantsPerClass: 1, description: 'Order, discipline, and structure.', displayOrder: 7 },
    { id: 8, name: 'Grammarian', maxParticipantsPerClass: 1, description: 'Language precision and correction.', displayOrder: 8 },
  ];

  const defaultPosters = ['U1', 'U2', 'U3', 'U4', 'U5', 'U6'].map((classCode) => buildFallbackPosterForClass(classCode));
  const posters = OFFLINE_POSTERS.length > 0 ? OFFLINE_POSTERS : defaultPosters;
  const participants = (OFFLINE_PARTICIPANTS.length > 0 ? OFFLINE_PARTICIPANTS : []) as any[];

  return {
    classes,
    categories,
    students: [],
    participants,
    classOfficers: [],
    posters,
    feedPosts: OFFLINE_FEED_POSTS,
    weeklyResults: OFFLINE_WEEKLY_RESULTS,
    libraryResources: OFFLINE_LIBRARY_RESOURCES,
    settings: {
      demoMode: 'true',
      offlineMode: 'true',
      platformName: 'ILM',
      siteTagline: 'Integrated Learning Master',
      aiAssistantEnabled: 'false',
    },
  };
}
