import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  AlertTriangle,
  Award,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  Crown,
  Download,
  Edit3,
  Eye,
  FileText,
  FolderKanban,
  GraduationCap,
  Home,
  Image as ImageIcon,
  LayoutDashboard,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Shield,
  Sliders,
  Trash2,
  Trophy,
  Upload,
  UserCheck,
  Users,
  X,
  XCircle,
  Globe,
} from 'lucide-react';
import {
  ActivityLogRecord,
  AdminUser,
  CategoryRecord,
  ClassCode,
  ClassOfficerRecord,
  ClassOfficerRole,
  ClassRecord,
  CompetitionCategoryName,
  FeedPostRecord,
  LibraryCategoryName,
  LibraryResourceRecord,
  ParticipantRecord,
  PosterRecord,
  StudentRecord,
  WeeklyResultRecord,
} from '../types.ts';
import { normalizeFetchError } from '../lib/error.ts';
import { IlmLogo, downloadPosterAsPng } from './IlmLogo.tsx';
import { PosterStageCard } from './PosterStageCard.tsx';
import { PosterPhotoshopStudio } from './PosterPhotoshopStudio.tsx';
import {
  CompetitionStageAndTimer,
  getProgramRoleLabel,
} from './CompetitionStageAndTimer.tsx';

const VALID_CLASSES: ClassCode[] = ['U1', 'U2', 'U3', 'U4', 'U5', 'U6'];

const COMPETITION_CATEGORIES: CompetitionCategoryName[] = [
  'Qirat',
  'Naat',
  'Speech',
  'Table Topic',
  'Aah Counter',
  'Evolution',
  'Marshal',
  'Grammarian',
];

const CATEGORY_ICONS: Record<CompetitionCategoryName, string> = {
  Qirat: '📿',
  Naat: '🎤',
  Speech: '🗣️',
  'Table Topic': '💬',
  'Aah Counter': '🔢',
  Evolution: '📈',
  Marshal: '🛡️',
  Grammarian: '📖',
};

const CATEGORY_MAX: Record<CompetitionCategoryName, number> = {
  Qirat: 1,
  Naat: 5,
  Speech: 5,
  'Table Topic': 5,
  'Aah Counter': 1,
  Evolution: 5,
  Marshal: 1,
  Grammarian: 1,
};

const TOTAL_CLASS_CAPACITY = Object.values(CATEGORY_MAX).reduce(
  (sum, count) => sum + count,
  0
);

const CLASS_OFFICER_ROLES: ClassOfficerRole[] = [
  'Class Teacher',
  'President',
  'Vice President of Membership',
  'Vice President of Education',
  'Vice President of Public Relations',
  'Secretary',
  'Treasurer',
];

const LIBRARY_CATEGORIES: LibraryCategoryName[] = [
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
];

const STUDIO_PORTRAIT_PRESETS = [
  {
    label: 'Portrait A (Scholar Female 1)',
    url: '/assets/images/scholar_portrait_ayesha_1791787508872.jpg',
  },
  {
    label: 'Portrait B (Scholar Male 1)',
    url: '/assets/images/scholar_portrait_ahmed_1791787523001.jpg',
  },
  {
    label: 'Portrait C (Scholar Female 2)',
    url: '/assets/images/scholar_portrait_zainab_1791787533783.jpg',
  },
  {
    label: 'Portrait D (Scholar Male 2)',
    url: '/assets/images/scholar_portrait_faizan_1791787544478.jpg',
  },
];

type AdminSection =
  | 'overview'
  | 'classes'
  | 'students'
  | 'officers'
  | 'participants'
  | 'categories'
  | 'posters'
  | 'feed'
  | 'results'
  | 'common-library'
  | 'class-libraries'
  | 'users'
  | 'logs'
  | 'settings';

interface AdminDashboardProps {
  token: string;
  currentUser: AdminUser;
  onLogout: () => void;
  onSwitchToPublic: () => void;
  onPublicDataChanged: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  token,
  currentUser,
  onLogout,
  onSwitchToPublic,
  onPublicDataChanged,
}) => {
  const isSuperAdmin = currentUser.role === 'SUPER_ADMIN';
  const isTeacher = currentUser.role === 'TEACHER';
  const hasGlobalControl = isSuperAdmin || isTeacher;
  const lockedClass = currentUser.assignedClass as ClassCode | null;

  const [activeSection, setActiveSection] = useState<AdminSection>('overview');
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [banner, setBanner] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Dashboard state loaded from backend
  const [classesList, setClassesList] = useState<ClassRecord[]>([]);
  const [categoriesList, setCategoriesList] = useState<CategoryRecord[]>([]);
  const [studentsList, setStudentsList] = useState<StudentRecord[]>([]);
  const [classOfficersList, setClassOfficersList] = useState<
    ClassOfficerRecord[]
  >([]);
  const [participantsList, setParticipantsList] = useState<ParticipantRecord[]>(
    []
  );
  const [postersList, setPostersList] = useState<PosterRecord[]>([]);
  const [feedList, setFeedList] = useState<FeedPostRecord[]>([]);
  const [resultsList, setResultsList] = useState<WeeklyResultRecord[]>([]);
  const [libraryList, setLibraryList] = useState<LibraryResourceRecord[]>([]);
  const [usersList, setUsersList] = useState<AdminUser[]>([]);
  const [logsList, setLogsList] = useState<ActivityLogRecord[]>([]);
  const [settingsMap, setSettingsMap] = useState<Record<string, string>>({});
  const aiAssistantEnabled = settingsMap.aiAssistantEnabled === 'true' || settingsMap.aiAssistantEnabled === 'on' || settingsMap.aiAssistantEnabled === '1';
  const [imgbbTestStatus, setImgbbTestStatus] = useState<{
    loading: boolean;
    success?: boolean;
    message?: string;
    imageUrl?: string;
  } | null>(null);
  const [supabaseTestStatus, setSupabaseTestStatus] = useState<{
    loading: boolean;
    success?: boolean;
    message?: string;
  } | null>(null);
  const [supabaseSyncStatus, setSupabaseSyncStatus] = useState<{
    loading: boolean;
    success?: boolean;
    message?: string;
  } | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);

  // Filter states
  const [selectedClassFilter, setSelectedClassFilter] = useState<
    'ALL' | ClassCode
  >(hasGlobalControl ? 'ALL' : lockedClass || 'U1');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<
    'ALL' | CompetitionCategoryName
  >('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Participant Form & Modal State
  const [showAddParticipantModal, setShowAddParticipantModal] = useState(false);
  const [editingParticipant, setEditingParticipant] =
    useState<ParticipantRecord | null>(null);
  const [pAdmissionNo, setPAdmissionNo] = useState('');
  const [pName, setPName] = useState('');
  const [pClass, setPClass] = useState<ClassCode>(lockedClass || 'U1');
  const [pCategory, setPCategory] =
    useState<CompetitionCategoryName>('Naat');
  const [pPhotoUrl, setPPhotoUrl] = useState(STUDIO_PORTRAIT_PRESETS[0].url);
  const [pOwnTopic, setPOwnTopic] = useState('');
  const [pDescription, setPDescription] = useState('');
  const [latestGeneratedPoster, setLatestGeneratedPoster] =
    useState<PosterRecord | null>(null);

  // Student Form State (Admission No + Name + Class)
  const [editingStudent, setEditingStudent] = useState<StudentRecord | null>(
    null
  );
  const [stAdmissionNo, setStAdmissionNo] = useState('');
  const [stName, setStName] = useState('');
  const [stClass, setStClass] = useState<ClassCode>(lockedClass || 'U1');
  const [stPhotoUrl, setStPhotoUrl] = useState(STUDIO_PORTRAIT_PRESETS[1].url);
  const [stBio, setStBio] = useState('');

  // Class Officer Form State (Strictly Super Admin only)
  const [offClass, setOffClass] = useState<ClassCode>(lockedClass || 'U1');
  const [offRole, setOffRole] = useState<ClassOfficerRole>('President');
  const [offName, setOffName] = useState('');
  const [offAdmissionNo, setOffAdmissionNo] = useState('');
  const [offPhotoUrl, setOffPhotoUrl] = useState(STUDIO_PORTRAIT_PRESETS[0].url);
  const [offResponsibilities, setOffResponsibilities] = useState('');

  // Photoshop Studio Modal State
  const [studioPoster, setStudioPoster] = useState<PosterRecord | null>(null);

  // Feed Form State
  const [editingFeedPost, setEditingFeedPost] =
    useState<FeedPostRecord | null>(null);
  const [fClass, setFClass] = useState<ClassCode>(lockedClass || 'U2');
  const [fTitle, setFTitle] = useState('');
  const [fCaption, setFCaption] = useState('');
  const [fMediaUrl, setFMediaUrl] = useState(STUDIO_PORTRAIT_PRESETS[1].url);
  const [fMediaType, setFMediaType] = useState<
    'PHOTO' | 'POSTER' | 'ANNOUNCEMENT'
  >('PHOTO');
  const [rejectionNotes, setRejectionNotes] = useState<Record<number, string>>(
    {}
  );

  // Weekly Result Form State (Super Admin only)
  const [rCategory, setRCategory] = useState<'Best Speaker' | 'Best Naat'>(
    'Best Speaker'
  );
  const [rWinnerName, setRWinnerName] = useState('');
  const [rWinnerClass, setRWinnerClass] = useState<ClassCode>('U3');
  const [rWinnerPhoto, setRWinnerPhoto] = useState(
    STUDIO_PORTRAIT_PRESETS[0].url
  );
  const [rWeekLabel, setRWeekLabel] = useState('Week 13 – 27 Apr 2025');
  const [rDate, setRDate] = useState('2025-04-27');
  const [rRemarks, setRRemarks] = useState('');

  // Digital Library Form State
  const [lTitle, setLTitle] = useState('');
  const [lAuthor, setLAuthor] = useState(currentUser.name);
  const [lCategory, setLCategory] = useState<LibraryCategoryName>('Books');
  const [lScope, setLScope] = useState<'COMMON' | ClassCode>(
    hasGlobalControl ? 'COMMON' : lockedClass || 'U2'
  );
  const [lDescription, setLDescription] = useState('');
  const [lFileUrl, setLFileUrl] = useState('');
  const [lFileType, setLFileType] = useState('PDF');
  const [lFileSize, setLFileSize] = useState('1.2 MB');
  const [lContentPreview, setLContentPreview] = useState('');

  // Admin User Management Form State (Super Admin only)
  const [uName, setUName] = useState('');
  const [uEmail, setUEmail] = useState('');
  const [uRole, setURole] = useState<'SUPER_ADMIN' | 'TEACHER' | 'CLASS_ADMIN'>(
    'CLASS_ADMIN'
  );
  const [uAssignedClass, setUAssignedClass] = useState<ClassCode>('U1');
  const [uPassword, setUPassword] = useState('IlmAdmin#2026');
  const [uReplaceExisting, setUReplaceExisting] = useState(true);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editUserName, setEditUserName] = useState('');
  const [editUserEmail, setEditUserEmail] = useState('');
  const [editUserPassword, setEditUserPassword] = useState('');
  const [editUserRole, setEditUserRole] = useState<
    'SUPER_ADMIN' | 'TEACHER' | 'CLASS_ADMIN'
  >('CLASS_ADMIN');
  const [editUserClass, setEditUserClass] = useState<ClassCode>('U1');

  // Confirm delete dialog state
  const [confirmDelete, setConfirmDelete] = useState<{
    type:
      | 'participant'
      | 'feed'
      | 'result'
      | 'library'
      | 'student'
      | 'officer'
      | 'user'
      | 'poster';
    id: number;
    label: string;
  } | null>(null);

  const authHeaders = useCallback(
    () => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    }),
    [token]
  );

  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/dashboard', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        onLogout();
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load dashboard');
      }
      setClassesList(data.classes || []);
      setCategoriesList(data.categories || []);
      setStudentsList(data.students || []);
      setClassOfficersList(data.classOfficers || []);
      setParticipantsList(data.participants || []);
      setPostersList(data.posters || []);
      setFeedList(data.feedPosts || []);
      setResultsList(data.weeklyResults || []);
      setLibraryList(data.libraryResources || []);
      setUsersList(data.users || []);
      setLogsList(data.activityLogs || []);
      setSettingsMap(data.settings || {});
    } catch (err: any) {
      setBanner({
        type: 'error',
        text: normalizeFetchError(err, 'Failed to load dashboard data.'),
      });
    } finally {
      setLoading(false);
    }
  }, [token, onLogout]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  // Auto-populate Class Teacher / Class Officer form fields with current holder's name & photo when class or role changes
  useEffect(() => {
    const targetClass = hasGlobalControl ? offClass : lockedClass || offClass;
    const found = classOfficersList.find(
      (o) =>
        o.classCode === targetClass &&
        o.roleTitle.trim().toLowerCase() === offRole.trim().toLowerCase()
    );
    if (found) {
      setOffName(found.holderName || '');
      setOffAdmissionNo(found.admissionNo || '');
      setOffPhotoUrl(found.photoUrl || STUDIO_PORTRAIT_PRESETS[0].url);
      setOffResponsibilities(found.responsibilities || '');
    } else {
      setOffName('');
      setOffAdmissionNo('');
      setOffPhotoUrl(STUDIO_PORTRAIT_PRESETS[0].url);
      setOffResponsibilities('');
    }
  }, [offClass, offRole, classOfficersList, hasGlobalControl, lockedClass]);

  // Helper to upload file to /api/admin/upload
  const handleFileUpload = async (
    file: File,
    onUploaded: (res: {
      fileUrl: string;
      fileType: string;
      fileSize: string;
    }) => void
  ) => {
    setActionBusy(true);
    setBanner(null);
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read local file'));
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/admin/upload', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          fileName: file.name,
          base64Data,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'File upload failed.');
      }
      onUploaded(data);
      setBanner({
        type: 'success',
        text: data.hostedOn
          ? `Uploaded ${file.name} (${data.fileSize}) to ImgBB (https://imgbb.com/) -> ${data.fileUrl}`
          : `Uploaded ${file.name} (${data.fileSize}) safely.`,
      });
    } catch (err: any) {
      setBanner({
        type: 'error',
        text: normalizeFetchError(err, 'File upload failed.'),
      });
    } finally {
      setActionBusy(false);
    }
  };

  // Add or Update Participant (Automatically generates/updates poster)
  const handleSaveParticipant = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionBusy(true);
    setBanner(null);
    try {
      const targetClass = hasGlobalControl ? pClass : lockedClass!;
      const endpoint = editingParticipant
        ? `/api/admin/participants/${editingParticipant.id}`
        : '/api/admin/participants';
      const method = editingParticipant ? 'PUT' : 'POST';

      const res = await fetch(endpoint, {
        method,
        headers: authHeaders(),
        body: JSON.stringify({
          admissionNo: pAdmissionNo.trim(),
          fullName: pName.trim(),
          photoUrl: pPhotoUrl,
          classCode: targetClass,
          categoryName: pCategory,
          ownTopic: pOwnTopic.trim(),
          shortDescription: pDescription.trim(),
          publicationStatus: 'PUBLISHED',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save participant.');
      }

      setPAdmissionNo('');
      setPName('');
      setPOwnTopic('');
      setPDescription('');
      setEditingParticipant(null);
      setShowAddParticipantModal(false);
      if (data.poster) {
        setLatestGeneratedPoster(data.poster);
      }
      setBanner({
        type: 'success',
        text: editingParticipant
          ? `Updated ${data.participant.fullName} and automatically regenerated the ${targetClass} class poster!`
          : `Added ${data.participant.fullName} to ${targetClass} (${pCategory}) and automatically generated the updated designer class poster!`,
      });
      await fetchDashboardData();
      onPublicDataChanged();
    } catch (err: any) {
      setBanner({
        type: 'error',
        text: err.message || 'Could not save participant.',
      });
    } finally {
      setActionBusy(false);
    }
  };

  // Execute confirmed deletion
  const handleConfirmDeleteAction = async () => {
    if (!confirmDelete) return;
    setActionBusy(true);
    setBanner(null);
    try {
      const { type, id, label } = confirmDelete;
      const endpoint =
        type === 'participant'
          ? `/api/admin/participants/${id}`
          : type === 'student'
          ? `/api/admin/students/${id}`
          : type === 'officer'
          ? `/api/admin/class-officers/${id}`
          : type === 'user'
          ? `/api/admin/users/${id}`
          : type === 'feed'
          ? `/api/admin/feed/${id}`
          : type === 'result'
          ? `/api/admin/results/${id}`
          : type === 'library'
          ? `/api/admin/library/${id}`
          : `/api/admin/posters/${id}`;

      const res = await fetch(endpoint, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Delete action failed.');
      }
      setConfirmDelete(null);
      setBanner({
        type: 'success',
        text:
          type === 'participant'
            ? `Removed ${label} and regenerated the corresponding class poster.`
            : type === 'poster'
            ? `Deleted poster "${label}" successfully.`
            : `Deleted "${label}" successfully.`,
      });
      await fetchDashboardData();
      onPublicDataChanged();
    } catch (err: any) {
      setBanner({
        type: 'error',
        text: err.message || 'Delete operation failed.',
      });
    } finally {
      setActionBusy(false);
    }
  };

  // Regenerate Poster manually
  const handleRegeneratePoster = async (
    classCode: ClassCode,
    categoryName: string
  ) => {
    setActionBusy(true);
    setBanner(null);
    try {
      const res = await fetch('/api/admin/posters/regenerate', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          classCode,
          categoryName:
            categoryName === 'Class Showcase' ? 'Speech' : categoryName,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to regenerate poster.');
      }
      setBanner({
        type: 'success',
        text: `Regenerated official poster for Class ${classCode} (${categoryName}).`,
      });
      await fetchDashboardData();
      onPublicDataChanged();
    } catch (err: any) {
      setBanner({
        type: 'error',
        text: err.message || 'Failed to regenerate poster.',
      });
    } finally {
      setActionBusy(false);
    }
  };

  // Toggle Poster publication status
  const handleTogglePosterStatus = async (poster: PosterRecord) => {
    setActionBusy(true);
    setBanner(null);
    try {
      const nextStatus =
        poster.publicationStatus === 'PUBLISHED' ? 'HIDDEN' : 'PUBLISHED';
      const res = await fetch(`/api/admin/posters/${poster.id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ publicationStatus: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update poster visibility.');
      }
      setBanner({
        type: 'success',
        text: `Poster "${poster.title}" is now ${nextStatus}.`,
      });
      await fetchDashboardData();
      onPublicDataChanged();
    } catch (err: any) {
      setBanner({
        type: 'error',
        text: err.message || 'Could not update poster status.',
      });
    } finally {
      setActionBusy(false);
    }
  };

  const handleToggleLibraryResourceStatus = async (
    resource: LibraryResourceRecord
  ) => {
    setActionBusy(true);
    setBanner(null);
    try {
      const nextStatus =
        resource.publicationStatus === 'PUBLISHED' ? 'HIDDEN' : 'PUBLISHED';
      const res = await fetch(`/api/admin/library/${resource.id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ publicationStatus: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update library visibility.');
      }
      setBanner({
        type: 'success',
        text: `Library resource "${resource.title}" is now ${nextStatus}.`,
      });
      await fetchDashboardData();
      onPublicDataChanged();
    } catch (err: any) {
      setBanner({
        type: 'error',
        text: err.message || 'Could not update library status.',
      });
    } finally {
      setActionBusy(false);
    }
  };

  const handleToggleAllLibraryResources = async () => {
    if (!libraryList.length) {
      setBanner({
        type: 'error',
        text: 'No library resources are available yet. Add a library item in the Library panel to enable the toggle.',
      });
      return;
    }

    setActionBusy(true);
    setBanner(null);
    try {
      const shouldPublish = !libraryList.some(
        (resource) => resource.publicationStatus === 'PUBLISHED'
      );
      const nextStatus = shouldPublish ? 'PUBLISHED' : 'HIDDEN';

      await Promise.all(
        libraryList.map(async (resource) => {
          const res = await fetch(`/api/admin/library/${resource.id}`, {
            method: 'PATCH',
            headers: authHeaders(),
            body: JSON.stringify({ publicationStatus: nextStatus }),
          });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(
              data.error || `Failed to update library visibility for ${resource.title}.`
            );
          }
        })
      );

      setBanner({
        type: 'success',
        text: `Library set to ${nextStatus}. All visible resources are now ${nextStatus}.`,
      });
      await fetchDashboardData();
      onPublicDataChanged();
    } catch (err: any) {
      setBanner({
        type: 'error',
        text: err.message || 'Could not update all library resources.',
      });
    } finally {
      setActionBusy(false);
    }
  };

  // Submit or Resubmit Class Feed Post
  const handleSaveFeedPost = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionBusy(true);
    setBanner(null);
    try {
      const targetClass = hasGlobalControl ? fClass : lockedClass!;
      const endpoint = editingFeedPost
        ? `/api/admin/feed/${editingFeedPost.id}`
        : '/api/admin/feed';
      const method = editingFeedPost ? 'PUT' : 'POST';

      const res = await fetch(endpoint, {
        method,
        headers: authHeaders(),
        body: JSON.stringify({
          classCode: targetClass,
          title: fTitle.trim(),
          caption: fCaption.trim(),
          mediaUrl: fMediaUrl,
          mediaType: fMediaType,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit feed post.');
      }

      setFTitle('');
      setFCaption('');
      setEditingFeedPost(null);
      setBanner({
        type: 'success',
        text: hasGlobalControl
          ? `Published feed post "${data.post.title}" for Class ${targetClass}.`
          : `Submitted "${data.post.title}" to the Super Admin for approval (Status: PENDING).`,
      });
      await fetchDashboardData();
      onPublicDataChanged();
    } catch (err: any) {
      setBanner({
        type: 'error',
        text: err.message || 'Failed to submit feed post.',
      });
    } finally {
      setActionBusy(false);
    }
  };

  // Moderate Feed Post (Super Admin only)
  const handleModerateFeedPost = async (
    postId: number,
    decision: 'APPROVED' | 'REJECTED'
  ) => {
    setActionBusy(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/admin/feed/${postId}/moderate`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          decision,
          rejectionReason: rejectionNotes[postId] || '',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Moderation failed.');
      }
      setBanner({
        type: 'success',
        text: `Post "${data.post.title}" has been ${decision.toLowerCase()}.`,
      });
      await fetchDashboardData();
      onPublicDataChanged();
    } catch (err: any) {
      setBanner({
        type: 'error',
        text: err.message || 'Moderation failed.',
      });
    } finally {
      setActionBusy(false);
    }
  };

  // Publish Weekly Result (Super Admin only)
  const handlePublishWeeklyResult = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionBusy(true);
    setBanner(null);
    try {
      const res = await fetch('/api/admin/results', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          resultCategory: rCategory,
          winnerName: rWinnerName.trim(),
          winnerClass: rWinnerClass,
          winnerPhotoUrl: rWinnerPhoto,
          weekLabel: rWeekLabel.trim(),
          resultDate: rDate,
          remarks: rRemarks.trim(),
          publicationStatus: 'PUBLISHED',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to publish weekly result.');
      }
      setRWinnerName('');
      setRRemarks('');
      setBanner({
        type: 'success',
        text: `Published official ${rCategory} result for ${rWeekLabel} (${data.result.winnerName} · ${data.result.winnerClass}). Past history remains preserved.`,
      });
      await fetchDashboardData();
      onPublicDataChanged();
    } catch (err: any) {
      setBanner({
        type: 'error',
        text: err.message || 'Failed to publish result.',
      });
    } finally {
      setActionBusy(false);
    }
  };

  // Add Digital Library Resource
  const handleAddLibraryResource = async (
    e: React.FormEvent,
    forcedScope?: 'COMMON' | ClassCode
  ) => {
    e.preventDefault();
    setActionBusy(true);
    setBanner(null);
    try {
      const effectiveScope = hasGlobalControl
        ? forcedScope || lScope
        : lockedClass!;

      const res = await fetch('/api/admin/library', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          title: lTitle.trim(),
          author: lAuthor.trim(),
          category: lCategory,
          libraryScope: effectiveScope,
          description: lDescription.trim(),
          fileUrl:
            lFileUrl.trim() ||
            `#resource-${lCategory.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
          fileType: lFileType,
          fileSize: lFileSize,
          contentPreview: lContentPreview.trim() || lDescription.trim(),
          publicationStatus: 'PUBLISHED',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to add library resource.');
      }

      setLTitle('');
      setLDescription('');
      setLFileUrl('');
      setLContentPreview('');
      setBanner({
        type: 'success',
        text: `Published "${data.resource.title}" (${data.resource.category}) to ${
          effectiveScope === 'COMMON'
            ? 'Common Public Library'
            : `Class ${effectiveScope} Library`
        }.`,
      });
      await fetchDashboardData();
      onPublicDataChanged();
    } catch (err: any) {
      setBanner({
        type: 'error',
        text: err.message || 'Failed to add library resource.',
      });
    } finally {
      setActionBusy(false);
    }
  };

  // Create Administrator User (Super Admin only)
  const handleCreateAdminUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionBusy(true);
    setBanner(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          name: uName.trim(),
          email: uEmail.trim(),
          role: uRole,
          assignedClass: uRole === 'CLASS_ADMIN' ? uAssignedClass : null,
          password: uPassword,
          replaceExistingClassAdmin: uReplaceExisting,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create administrator.');
      }
      setUName('');
      setUEmail('');
      setUReplaceExisting(false);
      setBanner({
        type: 'success',
        text: `Created administrator ${data.user.name} (${data.user.role}${
          data.user.assignedClass ? ` · ${data.user.assignedClass}` : ''
        }).`,
      });
      await fetchDashboardData();
    } catch (err: any) {
      setBanner({
        type: 'error',
        text: err.message || 'Failed to create administrator.',
      });
    } finally {
      setActionBusy(false);
    }
  };

  // Update Admin User Status, Gmail, Password, Role, or Class Assignment
  const handleUpdateAdminUser = async (
    userId: number,
    updates: {
      email?: string;
      name?: string;
      newPassword?: string;
      status?: 'ACTIVE' | 'DEACTIVATED';
      assignedClass?: ClassCode | null;
      role?: 'SUPER_ADMIN' | 'TEACHER' | 'CLASS_ADMIN';
      replaceExistingClassAdmin?: boolean;
    }
  ) => {
    setActionBusy(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update administrator.');
      }
      setEditingUser(null);
      setBanner({
        type: 'success',
        text: `Updated user ${data.user.email} (${data.user.role}${
          data.user.assignedClass ? ` · ${data.user.assignedClass}` : ''
        }).`,
      });
      await fetchDashboardData();
    } catch (err: any) {
      setBanner({
        type: 'error',
        text: err.message || 'Failed to update administrator.',
      });
    } finally {
      setActionBusy(false);
    }
  };

  // Save Platform Settings
  const handleSavePlatformSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionBusy(true);
    setBanner(null);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          settings: settingsMap,
          classDescriptions: classesList,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save platform settings.');
      }
      setBanner({
        type: 'success',
        text: 'Global platform settings and class metadata saved.',
      });
      await fetchDashboardData();
      onPublicDataChanged();
    } catch (err: any) {
      setBanner({
        type: 'error',
        text: err.message || 'Failed to save settings.',
      });
    } finally {
      setActionBusy(false);
    }
  };

  const handleTestImgBB = async () => {
    setImgbbTestStatus({ loading: true });
    try {
      const res = await fetch('/api/admin/test-imgbb', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ apiKey: settingsMap.imgbbApiKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        setImgbbTestStatus({
          loading: false,
          success: false,
          message: data.error || 'Failed to verify ImgBB key',
        });
      } else {
        setImgbbTestStatus({
          loading: false,
          success: true,
          message: data.message,
          imageUrl: data.testImageUrl,
        });
      }
    } catch (err: any) {
      setImgbbTestStatus({
        loading: false,
        success: false,
        message: err.message || 'Network error verifying ImgBB',
      });
    }
  };

  const handleTestSupabase = async () => {
    setSupabaseTestStatus({ loading: true });
    try {
      const res = await fetch('/api/admin/test-supabase', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          supabaseUrl: settingsMap.supabaseUrl,
          supabaseKey: settingsMap.supabaseAnonKey || settingsMap.supabaseServiceKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSupabaseTestStatus({
          loading: false,
          success: false,
          message: data.error || 'Failed to connect to Supabase',
        });
      } else {
        setSupabaseTestStatus({
          loading: false,
          success: true,
          message: data.message,
        });
      }
    } catch (err: any) {
      setSupabaseTestStatus({
        loading: false,
        success: false,
        message: err.message || 'Network error connecting to Supabase',
      });
    }
  };

  const handleCopySupabaseSql = async () => {
    try {
      const res = await fetch('/api/admin/supabase-schema-sql', {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (data.sql) {
        await navigator.clipboard.writeText(data.sql);
        setCopiedSql(true);
        setTimeout(() => setCopiedSql(false), 3500);
      }
    } catch {
      alert('Could not copy SQL script. Please check your connection.');
    }
  };

  const handleSyncToSupabase = async () => {
    setSupabaseSyncStatus({ loading: true });
    try {
      const res = await fetch('/api/admin/sync-to-supabase', {
        method: 'POST',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        setSupabaseSyncStatus({
          loading: false,
          success: false,
          message: data.error || 'Failed to sync data to Supabase.',
        });
      } else {
        setSupabaseSyncStatus({
          loading: false,
          success: true,
          message: data.message,
        });
      }
    } catch (err: any) {
      setSupabaseSyncStatus({
        loading: false,
        success: false,
        message: err.message || 'Network error syncing to Supabase.',
      });
    }
  };

  // Add or Update Student (Admission No + Name + Class)
  const handleSaveStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionBusy(true);
    setBanner(null);
    try {
      const targetClass = hasGlobalControl ? stClass : lockedClass!;
      const endpoint = editingStudent
        ? `/api/admin/students/${editingStudent.id}`
        : '/api/admin/students';
      const method = editingStudent ? 'PUT' : 'POST';

      const res = await fetch(endpoint, {
        method,
        headers: authHeaders(),
        body: JSON.stringify({
          admissionNo: stAdmissionNo.trim(),
          fullName: stName.trim(),
          classCode: targetClass,
          photoUrl: stPhotoUrl,
          bio: stBio.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save student.');
      }
      setStAdmissionNo('');
      setStName('');
      setStBio('');
      setEditingStudent(null);
      setBanner({
        type: 'success',
        text: editingStudent
          ? `Updated student ${data.student.fullName} (${data.student.admissionNo}) in Class ${targetClass}.`
          : `Added student ${data.student.fullName} (Admission No: ${data.student.admissionNo}) to Class ${targetClass}.`,
      });
      await fetchDashboardData();
      onPublicDataChanged();
    } catch (err: any) {
      setBanner({
        type: 'error',
        text: err.message || 'Failed to save student.',
      });
    } finally {
      setActionBusy(false);
    }
  };

  // Save Class Teacher or Class Officer
  const handleSaveClassOfficer = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionBusy(true);
    setBanner(null);
    try {
      const targetClass = hasGlobalControl ? offClass : lockedClass!;
      const res = await fetch('/api/admin/class-officers', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          classCode: targetClass,
          roleTitle: offRole,
          holderName: offName.trim(),
          admissionNo: offAdmissionNo.trim(),
          photoUrl: offPhotoUrl,
          responsibilities: offResponsibilities.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to assign Class Officer.');
      }
      setBanner({
        type: 'success',
        text: `Saved ${data.officer.holderName} as ${data.officer.roleTitle} for Class ${data.officer.classCode}.`,
      });
      await fetchDashboardData();
      onPublicDataChanged();
    } catch (err: any) {
      setBanner({
        type: 'error',
        text: err.message || 'Failed to save Class Officer.',
      });
    } finally {
      setActionBusy(false);
    }
  };

  // Save Edited Poster from Photoshop Studio (Also uploads PNG to ImgBB if PNG data URL)
  const handleSavePosterFromStudio = async (
    posterId: number,
    updatedDataUrl: string,
    title: string,
    subtitle: string,
    participantsSnapshot: string
  ) => {
    setActionBusy(true);
    setBanner(null);
    try {
      let finalPosterUrl = updatedDataUrl;
      if (updatedDataUrl.startsWith('data:image/png;base64,')) {
        try {
          const uploadRes = await fetch('/api/admin/upload', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
              fileName: `ilm_poster_${posterId}.png`,
              base64Data: updatedDataUrl,
            }),
          });
          const uploadJson = await uploadRes.json();
          if (uploadRes.ok && uploadJson.fileUrl) {
            finalPosterUrl = uploadJson.fileUrl;
          }
        } catch {
          // Keep data URL if offline
        }
      }

      const res = await fetch(`/api/admin/posters/${posterId}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({
          posterImageUrl: finalPosterUrl,
          title,
          subtitle,
          participantsSnapshot,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save edited poster.');
      }
      setStudioPoster(null);
      setBanner({
        type: 'success',
        text: `Saved custom Photoshop Studio poster for Class ${data.poster.classCode}.`,
      });
      await fetchDashboardData();
      onPublicDataChanged();
    } catch (err: any) {
      setBanner({
        type: 'error',
        text: err.message || 'Failed to save studio poster.',
      });
    } finally {
      setActionBusy(false);
    }
  };

  // Post a Class Poster directly to the Class Feed
  const handlePostPosterToFeed = async (
    poster: PosterRecord,
    customDataUrl?: string,
    customCaption?: string
  ) => {
    setActionBusy(true);
    setBanner(null);
    try {
      const res = await fetch('/api/admin/feed', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          classCode: poster.classCode,
          title: `Class ${poster.classCode} Official Competition Poster`,
          caption:
            customCaption ||
            `Official Class ${poster.classCode} Competition Lineup Poster featuring ${poster.participantCount} registered scholars across Qirat, Naat, Speech, Table Topic, Evolution, Aah Counter, Marshal, and Grammarian.`,
          mediaUrl: customDataUrl || poster.posterImageUrl,
          mediaType: 'POSTER',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to post poster to feed.');
      }
      setBanner({
        type: 'success',
        text: hasGlobalControl
          ? `Published Class ${poster.classCode} Poster directly to the public Feed!`
          : `Submitted Class ${poster.classCode} Poster to the Feed for Super Admin approval!`,
      });
      await fetchDashboardData();
      onPublicDataChanged();
    } catch (err: any) {
      setBanner({
        type: 'error',
        text: err.message || 'Failed to post poster to feed.',
      });
    } finally {
      setActionBusy(false);
    }
  };

  // Navigation items for Super Admin / Teacher vs Class Admin
  const sidebarItems: Array<{
    id: AdminSection;
    label: string;
    icon: React.FC<{ className?: string }>;
    badge?: number;
  }> = hasGlobalControl
    ? [
        { id: 'overview', label: 'Home', icon: Home },
        { id: 'classes', label: 'Classes (U1–U6)', icon: GraduationCap },
        { id: 'students', label: 'Students', icon: ClipboardList },
        { id: 'officers', label: 'Class Officers', icon: Crown },
        { id: 'participants', label: 'Participants', icon: Users },
        { id: 'results', label: 'Results', icon: Trophy },
        { id: 'posters', label: 'Class Posters', icon: ImageIcon },
        {
          id: 'feed',
          label: 'Feed',
          icon: CheckCircle2,
          badge: feedList.filter((f) => f.status === 'PENDING').length,
        },
        { id: 'common-library', label: 'Library', icon: BookOpen },
        { id: 'class-libraries', label: 'Class Libraries', icon: FileText },
        { id: 'categories', label: 'Categories & Limits', icon: FolderKanban },
        ...(isSuperAdmin
          ? [{ id: 'users' as AdminSection, label: 'Users', icon: Users }]
          : []),
        { id: 'logs', label: 'Activity Logs', icon: Activity },
        { id: 'settings', label: 'Settings', icon: Settings },
      ]
    : [
        {
          id: 'overview',
          label: `Home (${lockedClass})`,
          icon: Home,
        },
        {
          id: 'students',
          label: `Students (${lockedClass})`,
          icon: ClipboardList,
        },
        {
          id: 'officers',
          label: `Class Officers (${lockedClass})`,
          icon: Crown,
        },
        {
          id: 'participants',
          label: `Participants (${lockedClass})`,
          icon: Users,
        },
        {
          id: 'results',
          label: 'Results',
          icon: Trophy,
        },
        {
          id: 'posters',
          label: `Class Posters (${lockedClass})`,
          icon: ImageIcon,
        },
        {
          id: 'feed',
          label: `Feed (${lockedClass})`,
          icon: CheckCircle2,
        },
        {
          id: 'class-libraries',
          label: `Library (${lockedClass})`,
          icon: BookOpen,
        },
        {
          id: 'categories',
          label: `Category Limits`,
          icon: FolderKanban,
        },
      ];

  const pendingFeedCount = feedList.filter(
    (f) => f.status === 'PENDING'
  ).length;
  const posterErrorsCount = postersList.filter(
    (p) => p.generationStatus === 'FAILED'
  ).length;
  const activeClassAdminsCount = usersList.filter(
    (u) => u.role === 'CLASS_ADMIN' && u.status === 'ACTIVE'
  ).length;

  // Capacity check for the currently selected class & category in the Add Participant form
  const formTargetClass = hasGlobalControl ? pClass : lockedClass!;
  const currentCategoryRegisteredCount = participantsList.filter(
    (p) =>
      p.classCode === formTargetClass &&
      p.categoryName === pCategory &&
      (!editingParticipant || p.id !== editingParticipant.id)
  ).length;
  const currentCategoryLimit = CATEGORY_MAX[pCategory];
  const isFormCategoryAtCapacity =
    currentCategoryRegisteredCount >= currentCategoryLimit;

  return (
    <div className="h-screen max-h-screen w-full flex overflow-hidden bg-[#07080C] text-neutral-100">
      {/* =====================================================================
          SIDEBAR NAVIGATION (Fixed / Independent Left Scrolling)
         ===================================================================== */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col justify-between bg-[#0B0D14] border-r border-neutral-800/90 p-5 h-full max-h-screen overflow-hidden select-none">
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="pb-4 mb-3 border-b border-neutral-800 flex items-center justify-between shrink-0">
            <IlmLogo size="sm" showSubtitle />
          </div>

          <div className="mb-3 px-3 py-2 rounded-lg bg-[#121622] border border-[#D4AF37]/30 shrink-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#F3D068]">
              {isSuperAdmin
                ? 'Global Super Admin'
                : isTeacher
                ? 'Faculty Teacher (Full Control)'
                : `Class ${lockedClass} Administrator`}
            </div>
            <div className="text-xs text-white font-medium truncate mt-0.5">
              {currentUser.name}
            </div>
            <div className="text-[11px] text-neutral-400 truncate">
              {currentUser.email}
            </div>
          </div>

          {/* Navigation links - Independent scroll container for sidebar */}
          <nav className="flex-1 min-h-0 overflow-y-auto space-y-1 pr-1 overscroll-contain">
            {sidebarItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveSection(item.id)}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-gradient-to-r from-[#D4AF37]/20 to-transparent text-[#F3D068] border border-[#D4AF37]/40'
                      : 'text-neutral-300 hover:bg-neutral-900 hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-2.5 truncate">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-[#D4AF37] text-neutral-950 font-mono-tabular text-[10px] font-bold">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="pt-3 mt-2 border-t border-neutral-800 space-y-2 shrink-0">
          <button
            type="button"
            onClick={onSwitchToPublic}
            className="w-full flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#141824] hover:bg-[#1B2030] text-xs font-medium text-neutral-200 border border-neutral-700 cursor-pointer transition-colors"
          >
            <Globe className="w-4 h-4 text-[#D4AF37]" />
            <span>Public Website View</span>
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center gap-2 px-3.5 py-2 rounded-lg bg-red-950/30 hover:bg-red-950/60 text-xs font-medium text-red-300 border border-red-900/50 cursor-pointer transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* =====================================================================
          MAIN WORKSPACE CANVAS (Independent Right Pane Scrolling)
         ===================================================================== */}
      <div className="flex-1 flex flex-col min-w-0 h-full max-h-screen overflow-hidden">
        {/* Top Bar Contract for Admin Workspace - Fixed header */}
        <header className="shrink-0 z-20 bg-[#0B0D14]/95 backdrop-blur-md border-b border-neutral-800 px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-xs text-neutral-400">
              {isSuperAdmin
                ? 'ILM Global Administration'
                : isTeacher
                ? 'ILM Faculty Teacher Global Control'
                : `Class ${lockedClass} Isolated Administration`}
            </span>
            <span className="text-neutral-600" aria-hidden="true">
              /
            </span>
            <span className="text-sm font-semibold text-[#F3D068]">
              {sidebarItems.find((i) => i.id === activeSection)?.label}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {!hasGlobalControl && lockedClass && (
              <span className="text-xs font-semibold text-[#F3D068] tracking-wider uppercase">
                Assigned Class: {lockedClass} Only
              </span>
            )}
            {hasGlobalControl && (
              <button
                type="button"
                onClick={handleToggleAllLibraryResources}
                disabled={actionBusy}
                className={`px-3.5 py-1.5 rounded-lg border whitespace-nowrap shrink-0 cursor-pointer text-xs font-medium ${
                  libraryList.some((res) => res.publicationStatus === 'PUBLISHED')
                    ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700/50'
                    : 'bg-neutral-900 text-neutral-300 border-neutral-700'
                } ${actionBusy ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                Library: {libraryList.some((res) => res.publicationStatus === 'PUBLISHED') ? 'ON' : 'OFF'}
              </button>
            )}
            <button
              type="button"
              onClick={onSwitchToPublic}
              className="px-3.5 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-xs font-medium text-neutral-200 border border-neutral-700 whitespace-nowrap shrink-0 cursor-pointer"
            >
              View Public Site
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="px-3.5 py-1.5 rounded-lg bg-neutral-900 hover:bg-red-950/60 text-xs font-medium text-red-300 border border-neutral-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Logout
            </button>
          </div>
        </header>

        {/* Mobile Section Switcher */}
        <div className="lg:hidden shrink-0 bg-[#0E1118] border-b border-neutral-800 px-4 py-2.5 flex items-center gap-2 overflow-x-auto">
          {sidebarItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveSection(item.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 ${
                activeSection === item.id
                  ? 'bg-[#D4AF37] text-neutral-950 font-semibold'
                  : 'bg-neutral-900 text-neutral-300'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Right Side Independent Scroll Viewport */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {/* Status Notification Banner */}
          {banner && (
            <div
              className={`mx-6 mt-5 p-4 rounded-xl border flex items-center justify-between gap-4 text-xs sm:text-sm ${
                banner.type === 'success'
                  ? 'bg-emerald-950/50 border-emerald-700/60 text-emerald-200'
                  : 'bg-red-950/50 border-red-700/60 text-red-200'
              }`}
            >
              <span>{banner.text}</span>
              <button
                type="button"
                onClick={() => setBanner(null)}
                className="p-1 rounded hover:bg-black/30 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Main Section Content */}
          <main className="p-6 sm:p-8 space-y-8">
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((n) => (
                <div
                  key={n}
                  className="h-28 rounded-xl bg-[#0E1118] border border-neutral-800 animate-pulse"
                />
              ))}
            </div>
          ) : (
            <>
              {/* ===============================================================
                  SECTION 1: HOME (LIVE STAGE SHOWCASE, ALARM TIMER, CLASS ROSTER & MASTER POSTER)
                 =============================================================== */}
              {activeSection === 'overview' && (
                <div className="space-y-8">
                  <div className="sticky top-0 z-30 -mt-2 py-3 px-4 -mx-4 sm:-mx-8 sm:px-8 bg-[#07080C]/95 backdrop-blur-md border-b border-neutral-800/90 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg">
                    <div>
                      <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">
                        {isSuperAdmin
                          ? 'Super Admin Global Home & Live Stage'
                          : isTeacher
                          ? 'Teacher Global Home & Live Stage (All Classes U1–U6)'
                          : `Class ${lockedClass} Home Page & Competition Stage`}
                      </h1>
                      <p className="text-xs sm:text-sm text-neutral-400 mt-0.5">
                        {hasGlobalControl
                          ? 'Live stage showcase (Qirat → Naat → Speech → Table Topic), competition alarm timer, participant cards, and master class posters.'
                          : `Official Class ${lockedClass} Home Page: live stage program, alarm timer, participant cards, and unified master poster.`}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingParticipant(null);
                          setPName('');
                          setPAdmissionNo('');
                          setPOwnTopic('');
                          setPDescription('');
                          setShowAddParticipantModal(true);
                        }}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#C89D2E] via-[#E8C55B] to-[#C89D2E] hover:brightness-110 text-neutral-950 font-bold text-xs cursor-pointer shadow-lg transition-transform active:scale-95"
                      >
                        <Plus className="w-4 h-4" />
                        <span>+ Add Participant</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveSection('posters')}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#151924] hover:bg-[#1C2130] text-white border border-neutral-700 text-xs font-medium cursor-pointer"
                      >
                        <ImageIcon className="w-4 h-4 text-[#D4AF37]" />
                        <span>Class Posters</span>
                      </button>
                    </div>
                  </div>

                  {/* LIVE STAGE SHOWCASE + COMPETITION ALARM TIMER (Ordered: 1. Qirat -> 2. Naat -> 3. Speech -> 4. Table Topic) */}
                  <CompetitionStageAndTimer
                    participants={participantsList}
                    activeClassFilter={hasGlobalControl ? 'ALL' : lockedClass!}
                    allowClassSwitch={hasGlobalControl}
                    title={
                      hasGlobalControl
                        ? 'Class Live Stage Program & Competition Timer'
                        : `Class ${lockedClass} Live Stage & Competition Timer`
                    }
                  />

                  {/* CLASS PARTICIPANT PHOTO & ROLE SHOWCASE ON HOME PAGE */}
                  <div className="p-6 rounded-2xl bg-[#0E1118] border border-neutral-800 space-y-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <span className="text-[11px] font-semibold uppercase tracking-widest text-[#F3D068]">
                          Class Home Page Participant Lineup
                        </span>
                        <h2 className="font-display text-xl font-bold text-white mt-0.5">
                          {hasGlobalControl
                            ? selectedClassFilter === 'ALL'
                              ? 'All Classes (U1–U6) Registered Participants & Roles'
                              : `Class ${selectedClassFilter} Registered Participants & Roles`
                            : `Class ${lockedClass} Registered Participants & Roles`}
                        </h2>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {hasGlobalControl && (
                          <div className="flex items-center gap-1 bg-[#121622] p-1 rounded-xl border border-neutral-800">
                            <button
                              type="button"
                              onClick={() => setSelectedClassFilter('ALL')}
                              className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                                selectedClassFilter === 'ALL'
                                  ? 'bg-[#D4AF37] text-neutral-950'
                                  : 'text-neutral-300 hover:text-white'
                              }`}
                            >
                              All
                            </button>
                            {VALID_CLASSES.map((c) => (
                              <button
                                key={c}
                                type="button"
                                onClick={() => setSelectedClassFilter(c)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                                  selectedClassFilter === c
                                    ? 'bg-[#D4AF37] text-neutral-950'
                                    : 'text-neutral-300 hover:text-white'
                                }`}
                              >
                                {c}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                      {participantsList
                        .filter((p) =>
                          hasGlobalControl
                            ? selectedClassFilter === 'ALL' ||
                              p.classCode === selectedClassFilter
                            : p.classCode === lockedClass
                        )
                        .map((p) => {
                          const roleLabel =
                            p.categoryName === 'Speech'
                              ? 'SPEAKER (SPEECH)'
                              : p.categoryName === 'Naat'
                              ? 'NAAT RECITER (NAAT)'
                              : p.categoryName === 'Qirat'
                              ? 'QIRAT RECITER (QIRAT)'
                              : p.categoryName === 'Table Topic'
                              ? 'TABLE TOPIC SPEAKER'
                              : p.categoryName === 'Evolution'
                              ? 'EVALUATOR (EVOLUTION)'
                              : p.categoryName.toUpperCase();
                          return (
                            <div
                              key={p.id}
                              className="rounded-xl bg-[#121622] border border-neutral-800/90 hover:border-[#D4AF37]/50 overflow-hidden flex flex-col justify-between transition-all"
                            >
                              <div className="p-4 flex items-center gap-3.5">
                                <img
                                  src={p.photoUrl}
                                  alt={p.fullName}
                                  referrerPolicy="no-referrer"
                                  className="w-16 h-16 rounded-xl object-cover object-top border-2 border-[#D4AF37] shrink-0"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="px-2 py-0.5 rounded bg-[#D4AF37]/20 text-[#F3D068] font-mono-tabular text-[10px] font-bold">
                                      Class {p.classCode}
                                    </span>
                                    {p.admissionNo && (
                                      <span className="text-[10px] font-mono-tabular text-neutral-400">
                                        #{p.admissionNo}
                                      </span>
                                    )}
                                  </div>
                                  <h3 className="font-display font-bold text-sm text-white truncate mt-1">
                                    {p.fullName}
                                  </h3>
                                  <div className="text-[11px] font-semibold text-emerald-300 truncate mt-0.5">
                                    {roleLabel}
                                  </div>
                                  {(p.ownTopic || p.shortDescription) && (
                                    <p className="text-[11px] text-neutral-400 truncate mt-0.5">
                                      Topic: {p.ownTopic || p.shortDescription}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>

                  {/* MASTER CLASS POSTER DIRECTLY ON HOME PAGE */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[11px] font-semibold uppercase tracking-widest text-[#F3D068]">
                          Unified 1-Page Designer Class Poster
                        </span>
                        <h2 className="font-display text-xl font-bold text-white">
                          {hasGlobalControl
                            ? 'Official Class Competition Posters (All Categories Combined)'
                            : `Class ${lockedClass} Official Master Poster`}
                        </h2>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                      {postersList
                        .filter(
                          (p) =>
                            p.categoryName === 'All Categories' &&
                            (!hasGlobalControl ||
                              selectedClassFilter === 'ALL' ||
                              p.classCode === selectedClassFilter)
                        )
                        .map((poster) => (
                          <PosterStageCard
                            key={poster.id}
                            poster={poster}
                            liveParticipants={participantsList}
                            canManage={true}
                            onRegenerate={() =>
                              handleRegeneratePoster(
                                poster.classCode,
                                poster.categoryName
                              )
                            }
                            onOpenStudio={(target) => setStudioPoster(target)}
                            onPostToFeed={(target) =>
                              handlePostPosterToFeed(target)
                            }
                            onPosterUpdated={() => {
                              fetchDashboardData();
                              onPublicDataChanged();
                            }}
                          />
                        ))}
                    </div>
                  </div>

                  {/* Overview Metric Cards (All calculated from real database records) */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    <div className="p-5 rounded-xl bg-[#0E1118] border border-neutral-800">
                      <div className="text-xs text-neutral-400">
                        {hasGlobalControl ? 'Supported Classes' : 'Assigned Cohort'}
                      </div>
                      <div className="font-mono-tabular text-2xl sm:text-3xl font-bold text-[#F3D068] mt-1">
                        {hasGlobalControl ? classesList.length : lockedClass}
                      </div>
                      <div className="text-[11px] text-neutral-500 mt-1">
                        {hasGlobalControl
                          ? 'U1, U2, U3, U4, U5, U6 (No U7)'
                          : 'Strict Backend Isolation Active'}
                      </div>
                    </div>

                    <div className="p-5 rounded-xl bg-[#0E1118] border border-neutral-800">
                      <div className="text-xs text-neutral-400">
                        Registered Participants
                      </div>
                      <div className="font-mono-tabular text-2xl sm:text-3xl font-bold text-white mt-1">
                        {participantsList.length}
                      </div>
                      <div className="text-[11px] text-neutral-500 mt-1 font-mono-tabular">
                        Capacity: {participantsList.length} /{' '}
                        {hasGlobalControl
                          ? TOTAL_CLASS_CAPACITY * 6
                          : TOTAL_CLASS_CAPACITY}{' '}
                        Places
                      </div>
                    </div>

                    <div className="p-5 rounded-xl bg-[#0E1118] border border-neutral-800">
                      <div className="text-xs text-neutral-400">
                        Pending Feed Submissions
                      </div>
                      <div className="font-mono-tabular text-2xl sm:text-3xl font-bold text-amber-300 mt-1">
                        {pendingFeedCount}
                      </div>
                      <div className="text-[11px] text-neutral-500 mt-1">
                        {hasGlobalControl
                          ? 'Awaiting moderation review'
                          : 'Submitted for moderation'}
                      </div>
                    </div>

                    <div className="p-5 rounded-xl bg-[#0E1118] border border-neutral-800">
                      <div className="text-xs text-neutral-400">
                        Published Posters
                      </div>
                      <div className="font-mono-tabular text-2xl sm:text-3xl font-bold text-white mt-1">
                        {
                          postersList.filter(
                            (p) => p.publicationStatus === 'PUBLISHED'
                          ).length
                        }
                      </div>
                      <div className="text-[11px] text-neutral-500 mt-1">
                        Generation Errors: {posterErrorsCount}
                      </div>
                    </div>

                    <div className="p-5 rounded-xl bg-[#0E1118] border border-neutral-800">
                      <div className="text-xs text-neutral-400">
                        Official Weekly Results
                      </div>
                      <div className="font-mono-tabular text-2xl sm:text-3xl font-bold text-[#F3D068] mt-1">
                        {resultsList.length}
                      </div>
                      <div className="text-[11px] text-neutral-500 mt-1">
                        Best Speaker & Best Naat Archive
                      </div>
                    </div>

                    <div className="p-5 rounded-xl bg-[#0E1118] border border-neutral-800">
                      <div className="text-xs text-neutral-400">
                        Digital Library Resources
                      </div>
                      <div className="font-mono-tabular text-2xl sm:text-3xl font-bold text-white mt-1">
                        {libraryList.length}
                      </div>
                      <div className="text-[11px] text-neutral-500 mt-1">
                        Across 11 Resource Categories
                      </div>
                    </div>

                    {isSuperAdmin && (
                      <>
                        <div className="p-5 rounded-xl bg-[#0E1118] border border-neutral-800">
                          <div className="text-xs text-neutral-400">
                            Active Class Admins
                          </div>
                          <div className="font-mono-tabular text-2xl sm:text-3xl font-bold text-emerald-300 mt-1">
                            {activeClassAdminsCount} / 6
                          </div>
                          <div className="text-[11px] text-neutral-500 mt-1">
                            1 Active Class Admin per Class
                          </div>
                        </div>

                        <div className="p-5 rounded-xl bg-[#0E1118] border border-neutral-800">
                          <div className="text-xs text-neutral-400">
                            Total Admin Accounts
                          </div>
                          <div className="font-mono-tabular text-2xl sm:text-3xl font-bold text-white mt-1">
                            {usersList.length}
                          </div>
                          <div className="text-[11px] text-neutral-500 mt-1">
                            Super Admins & Class Admins
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Quick Actions Bar */}
                  <div className="p-6 rounded-xl bg-[#0E1118] border border-neutral-800">
                    <h2 className="font-display text-base font-bold text-white mb-4">
                      Quick Administrative Actions
                    </h2>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setActiveSection('participants')}
                        className="px-4 py-2.5 rounded-lg bg-[#D4AF37] text-neutral-950 font-semibold text-xs cursor-pointer"
                      >
                        + Add Participant & Auto-Generate Poster
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveSection('posters')}
                        className="px-4 py-2.5 rounded-lg bg-[#151924] hover:bg-[#1C2130] text-white border border-neutral-700 text-xs font-medium cursor-pointer"
                      >
                        Manage Posters ({postersList.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveSection('feed')}
                        className="px-4 py-2.5 rounded-lg bg-[#151924] hover:bg-[#1C2130] text-white border border-neutral-700 text-xs font-medium cursor-pointer"
                      >
                        {hasGlobalControl
                          ? `Review Pending Feed (${pendingFeedCount})`
                          : 'Submit Class Feed Post'}
                      </button>
                      {hasGlobalControl && (
                        <button
                          type="button"
                          onClick={() => setActiveSection('results')}
                          className="px-4 py-2.5 rounded-lg bg-[#151924] hover:bg-[#1C2130] text-[#F3D068] border border-[#D4AF37]/40 text-xs font-medium cursor-pointer"
                        >
                          Publish Weekly Result
                        </button>
                      )}
                      {isSuperAdmin && (
                        <button
                          type="button"
                          onClick={() => setActiveSection('users')}
                          className="px-4 py-2.5 rounded-lg bg-[#151924] hover:bg-[#1C2130] text-white border border-neutral-700 text-xs font-medium cursor-pointer"
                        >
                          Manage Administrators
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Participants by Class & Recent Activity */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <div className="lg:col-span-6 p-6 rounded-xl bg-[#0E1118] border border-neutral-800">
                      <h3 className="font-display text-base font-bold text-white mb-4">
                        {hasGlobalControl
                          ? 'Participants & Capacity by Class (U1–U6)'
                          : `Class ${lockedClass} Competition Occupancy`}
                      </h3>
                      <div className="space-y-3.5">
                        {(hasGlobalControl ? VALID_CLASSES : [lockedClass!]).map(
                          (cls) => {
                            const count = participantsList.filter(
                              (p) => p.classCode === cls
                            ).length;
                            return (
                              <div key={cls}>
                                <div className="flex items-center justify-between text-xs mb-1">
                                  <span className="font-semibold text-white">
                                    Class {cls}
                                  </span>
                                  <span className="font-mono-tabular text-[#F3D068]">
                                    {count} / {TOTAL_CLASS_CAPACITY} Scholars
                                  </span>
                                </div>
                                <div className="w-full h-2 rounded-full bg-neutral-900 overflow-hidden">
                                  <div
                                    className="h-full bg-[#D4AF37]"
                                    style={{
                                      width: `${Math.min(
                                        100,
                                        (count / TOTAL_CLASS_CAPACITY) * 100
                                      )}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            );
                          }
                        )}
                      </div>
                    </div>

                    <div className="lg:col-span-6 p-6 rounded-xl bg-[#0E1118] border border-neutral-800">
                      <h3 className="font-display text-base font-bold text-white mb-4">
                        Recent Administrative Activity
                      </h3>
                      <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                        {logsList.slice(0, 8).map((log) => (
                          <div
                            key={log.id}
                            className="p-3 rounded-lg bg-[#0A0C12] border border-neutral-800/80 text-xs"
                          >
                            <div className="flex items-center justify-between text-neutral-400 mb-1">
                              <span className="font-semibold text-[#F3D068]">
                                {log.action}
                              </span>
                              <span className="font-mono-tabular text-[11px]">
                                {new Date(log.createdAt).toLocaleTimeString(
                                  [],
                                  { hour: '2-digit', minute: '2-digit' }
                                )}
                              </span>
                            </div>
                            <p className="text-neutral-200">{log.details}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ===============================================================
                  SECTION 2: CLASSES (U1–U6) GLOBAL MANAGEMENT (SUPER ADMIN & TEACHER)
                 =============================================================== */}
              {activeSection === 'classes' && hasGlobalControl && (
                <div className="space-y-6">
                  <div>
                    <h1 className="font-display text-2xl font-bold text-white">
                      All Six Classes (U1 – U6)
                    </h1>
                    <p className="text-sm text-neutral-400 mt-1">
                      Inspect class cohorts, assigned Class Admins, participant counts, and jump directly to class records.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {VALID_CLASSES.map((clsCode) => {
                      const clsMeta = classesList.find(
                        (c) => c.code === clsCode
                      );
                      const assignedAdmin = usersList.find(
                        (u) =>
                          u.role === 'CLASS_ADMIN' &&
                          u.assignedClass === clsCode &&
                          u.status === 'ACTIVE'
                      );
                      const clsParticipants = participantsList.filter(
                        (p) => p.classCode === clsCode
                      );
                      const clsPosters = postersList.filter(
                        (p) => p.classCode === clsCode
                      );

                      return (
                        <div
                          key={clsCode}
                          className="p-6 rounded-xl bg-[#0E1118] border border-neutral-800 flex flex-col justify-between"
                        >
                          <div>
                            <div className="flex items-center justify-between">
                              <span className="font-display text-2xl font-bold text-[#F3D068]">
                                Class {clsCode}
                              </span>
                              <span className="font-mono-tabular text-xs text-neutral-400">
                                {clsParticipants.length} / {TOTAL_CLASS_CAPACITY} Scholars
                              </span>
                            </div>
                            <h3 className="font-semibold text-white text-sm mt-2">
                              {clsMeta?.name || `Class ${clsCode}`}
                            </h3>
                            <p className="text-xs text-neutral-400 mt-1">
                              {clsMeta?.description}
                            </p>

                            <div className="mt-4 pt-3 border-t border-neutral-800 text-xs space-y-1">
                              <div className="text-neutral-400">
                                Active Class Admin:{' '}
                                <span className="text-white font-medium">
                                  {assignedAdmin
                                    ? `${assignedAdmin.name} (${assignedAdmin.email})`
                                    : 'Unassigned'}
                                </span>
                              </div>
                              <div className="text-neutral-400">
                                Generated Posters:{' '}
                                <span className="text-white font-mono-tabular">
                                  {clsPosters.length}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="mt-5 pt-3 border-t border-neutral-800 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedClassFilter(clsCode);
                                setPClass(clsCode);
                                setActiveSection('participants');
                              }}
                              className="flex-1 py-2 px-3 rounded-lg bg-[#D4AF37] text-neutral-950 font-semibold text-xs cursor-pointer"
                            >
                              Manage {clsCode} Scholars
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedClassFilter(clsCode);
                                setActiveSection('posters');
                              }}
                              className="py-2 px-3 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-xs text-neutral-200 border border-neutral-700 cursor-pointer"
                            >
                              Posters
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ===============================================================
                  SECTION 2B: STUDENTS ROSTER (ADMISSION NO, NAME, CLASS)
                 =============================================================== */}
              {activeSection === 'students' && (
                <div className="space-y-8">
                  <div className="sticky top-0 z-30 -mt-2 py-3 px-4 -mx-4 sm:-mx-8 sm:px-8 bg-[#07080C]/95 backdrop-blur-md border-b border-neutral-800/90 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg">
                    <div>
                      <h1 className="font-display text-2xl font-bold text-white">
                        {hasGlobalControl
                          ? 'Student Directory (Admission No, Name & Class U1–U6)'
                          : `Class ${lockedClass} Student Roster`}
                      </h1>
                      <p className="text-xs sm:text-sm text-neutral-400 mt-0.5">
                        {hasGlobalControl
                          ? 'Add or manage students across Classes U1–U6 with Admission Number, Full Name, and Class assignment.'
                          : `Add or manage students for Class ${lockedClass}.`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingStudent(null);
                          setStAdmissionNo('');
                          setStName('');
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#C89D2E] via-[#E8C55B] to-[#C89D2E] text-neutral-950 font-bold text-xs cursor-pointer shadow"
                      >
                        + Add Student / Candidate
                      </button>
                    </div>
                  </div>

                  {/* Add / Edit Student Form */}
                  <form
                    onSubmit={handleSaveStudent}
                    className="p-6 rounded-xl bg-[#0E1118] border border-[#D4AF37]/40 space-y-4"
                  >
                    <div className="flex items-center justify-between">
                      <h2 className="font-display text-lg font-bold text-white">
                        {editingStudent
                          ? `Edit Student: ${editingStudent.fullName} (${editingStudent.admissionNo})`
                          : 'Add Student to Class Roster'}
                      </h2>
                      {editingStudent && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingStudent(null);
                            setStAdmissionNo('');
                            setStName('');
                          }}
                          className="text-xs text-neutral-400 hover:text-white cursor-pointer"
                        >
                          Cancel Edit
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                      <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1">
                          Admission No *
                        </label>
                        <input
                          type="text"
                          required
                          value={stAdmissionNo}
                          onChange={(e) => setStAdmissionNo(e.target.value)}
                          placeholder="e.g., ADM-U1-109"
                          className="w-full px-3.5 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white font-mono focus:border-[#D4AF37] focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1">
                          Student Full Name *
                        </label>
                        <input
                          type="text"
                          required
                          value={stName}
                          onChange={(e) => setStName(e.target.value)}
                          placeholder="e.g., Muhammed Sinan"
                          className="w-full px-3.5 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white focus:border-[#D4AF37] focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1">
                          Class Cohort (U1–U6) *
                        </label>
                        <select
                          value={hasGlobalControl ? stClass : lockedClass!}
                          disabled={!hasGlobalControl}
                          onChange={(e) =>
                            setStClass(e.target.value as ClassCode)
                          }
                          className="w-full px-3.5 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white focus:border-[#D4AF37] focus:outline-none disabled:opacity-60"
                        >
                          {VALID_CLASSES.map((c) => (
                            <option key={c} value={c}>
                              Class {c}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-center gap-2">
                        <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#161A26] text-[#F3D068] border border-[#D4AF37]/40 text-xs font-medium cursor-pointer">
                          <Upload className="w-3.5 h-3.5" />
                          <span>Photo</span>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                handleFileUpload(file, (uploaded) =>
                                  setStPhotoUrl(uploaded.fileUrl)
                                );
                              }
                            }}
                          />
                        </label>
                        <button
                          type="submit"
                          disabled={actionBusy}
                          className="flex-1 py-2 px-4 rounded-lg bg-[#D4AF37] text-neutral-950 font-semibold text-xs cursor-pointer"
                        >
                          {editingStudent ? 'Save Changes' : '+ Add Student'}
                        </button>
                      </div>
                    </div>
                  </form>

                  {/* Students Table */}
                  <div className="rounded-xl bg-[#0E1118] border border-neutral-800 overflow-hidden">
                    <div className="p-4 border-b border-neutral-800 flex flex-wrap items-center justify-between gap-3">
                      <h3 className="font-display font-bold text-base text-white">
                        Enrolled Students ({studentsList.length})
                      </h3>
                      {hasGlobalControl && (
                        <select
                          value={selectedClassFilter}
                          onChange={(e) =>
                            setSelectedClassFilter(
                              e.target.value as 'ALL' | ClassCode
                            )
                          }
                          className="px-3 py-1.5 rounded-lg bg-[#12151F] border border-neutral-700 text-xs text-white"
                        >
                          <option value="ALL">All Classes (U1–U6)</option>
                          {VALID_CLASSES.map((c) => (
                            <option key={c} value={c}>
                              Class {c}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-neutral-800 text-xs text-neutral-400 uppercase">
                            <th className="py-3 px-4">Student</th>
                            <th className="py-3 px-4">Admission No</th>
                            <th className="py-3 px-4">Class</th>
                            <th className="py-3 px-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-800/80 text-sm">
                          {studentsList
                            .filter(
                              (s) =>
                                !hasGlobalControl ||
                                selectedClassFilter === 'ALL' ||
                                s.classCode === selectedClassFilter
                            )
                            .map((st) => (
                              <tr key={st.id} className="hover:bg-[#141824]">
                                <td className="py-3 px-4">
                                  <div className="flex items-center gap-3">
                                    <img
                                      src={st.photoUrl}
                                      alt={st.fullName}
                                      referrerPolicy="no-referrer"
                                      className="w-9 h-9 rounded-lg object-cover object-top border border-[#D4AF37]/50"
                                    />
                                    <span className="font-semibold text-white">
                                      {st.fullName}
                                    </span>
                                  </div>
                                </td>
                                <td className="py-3 px-4 font-mono-tabular text-xs text-emerald-300 font-semibold">
                                  {st.admissionNo}
                                </td>
                                <td className="py-3 px-4 font-mono-tabular text-xs text-[#F3D068]">
                                  Class {st.classCode}
                                </td>
                                <td className="py-3 px-4 text-right">
                                  <div className="inline-flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingStudent(st);
                                        setStAdmissionNo(st.admissionNo);
                                        setStName(st.fullName);
                                        setStClass(st.classCode);
                                        setStPhotoUrl(st.photoUrl);
                                      }}
                                      className="px-2.5 py-1 rounded bg-neutral-900 hover:bg-neutral-800 text-xs text-neutral-200 border border-neutral-700 cursor-pointer"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setPClass(st.classCode);
                                        setPName(st.fullName);
                                        setPAdmissionNo(st.admissionNo);
                                        setPPhotoUrl(st.photoUrl);
                                        setShowAddParticipantModal(true);
                                      }}
                                      className="px-2.5 py-1 rounded bg-[#D4AF37]/20 hover:bg-[#D4AF37]/30 text-xs text-[#F3D068] border border-[#D4AF37]/40 cursor-pointer"
                                    >
                                      + Add to Competition
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setConfirmDelete({
                                          type: 'student',
                                          id: st.id,
                                          label: `${st.fullName} (${st.admissionNo})`,
                                        })
                                      }
                                      className="px-2.5 py-1 rounded bg-red-950/40 hover:bg-red-950/80 text-xs text-red-300 border border-red-900/50 cursor-pointer"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* ===============================================================
                  SECTION 2C: CLASS TEACHER & CLASS OFFICERS MANAGEMENT
                 =============================================================== */}
              {activeSection === 'officers' && (
                <div className="space-y-8">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <div className="inline-flex items-center gap-2 text-[#F3D068] text-xs font-semibold uppercase tracking-widest mb-1">
                        <Crown className="w-4 h-4" />
                        <span>Class Teacher & Executive Leadership Section</span>
                      </div>
                      <h1 className="font-display text-2xl font-bold text-white">
                        {hasGlobalControl
                          ? 'Class Teachers & Class Officers (U1 – U6)'
                          : `Class ${lockedClass} Class Teacher & Executive Officers`}
                      </h1>
                      <p className="text-sm text-neutral-400 mt-1">
                        Assign or update the{' '}
                        <strong className="text-[#F3D068]">Class Teacher</strong>{' '}
                        and all 6 official Class Officer roles: President, Vice President of Membership, Vice President of Education, Vice President of Public Relations, Secretary, and Treasurer — complete with photograph and name.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setOffRole('Class Teacher');
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#C89D2E] via-[#E8C55B] to-[#C89D2E] text-neutral-950 font-bold text-xs cursor-pointer shadow"
                      >
                        + Assign / Edit Class Teacher
                      </button>
                    </div>
                  </div>

                  {/* Form to Add / Edit Class Teacher or Class Officer */}
                  <form
                    onSubmit={handleSaveClassOfficer}
                    className="p-6 rounded-xl bg-[#0E1118] border border-[#D4AF37]/40 space-y-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="font-display text-lg font-bold text-white">
                        {offRole === 'Class Teacher'
                          ? `Assign / Update Class Teacher (Class ${
                              hasGlobalControl ? offClass : lockedClass
                            })`
                          : `Assign / Update ${offRole} (Class ${
                              hasGlobalControl ? offClass : lockedClass
                            })`}
                      </h2>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {CLASS_OFFICER_ROLES.map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => setOffRole(r)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                              offRole === r
                                ? 'bg-[#D4AF37] text-neutral-950 border-[#D4AF37]'
                                : 'bg-[#121622] text-neutral-300 border-neutral-800 hover:text-white'
                            }`}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1">
                          Class Cohort (U1–U6) *
                        </label>
                        <select
                          value={hasGlobalControl ? offClass : lockedClass!}
                          disabled={!hasGlobalControl}
                          onChange={(e) =>
                            setOffClass(e.target.value as ClassCode)
                          }
                          className="w-full px-3.5 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white disabled:opacity-60"
                        >
                          {VALID_CLASSES.map((c) => (
                            <option key={c} value={c}>
                              Class {c}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1">
                          Role (Class Teacher / 6 Officers) *
                        </label>
                        <select
                          value={offRole}
                          onChange={(e) =>
                            setOffRole(e.target.value as ClassOfficerRole)
                          }
                          className="w-full px-3.5 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white"
                        >
                          {CLASS_OFFICER_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1">
                          {offRole === 'Class Teacher'
                            ? 'Class Teacher Full Name *'
                            : 'Officer Full Name *'}
                        </label>
                        <input
                          type="text"
                          required
                          value={offName}
                          onChange={(e) => setOffName(e.target.value)}
                          placeholder={
                            offRole === 'Class Teacher'
                              ? 'e.g., Prof. Maulana Tariq'
                              : 'e.g., Abdullah Tariq'
                          }
                          className="w-full px-3.5 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1">
                          {offRole === 'Class Teacher'
                            ? 'Faculty / Staff ID'
                            : 'Admission No'}
                        </label>
                        <input
                          type="text"
                          value={offAdmissionNo}
                          onChange={(e) => setOffAdmissionNo(e.target.value)}
                          placeholder={
                            offRole === 'Class Teacher'
                              ? 'e.g., FAC-U1-01'
                              : 'e.g., ADM-U1-101'
                          }
                          className="w-full px-3.5 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white font-mono"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1">
                          Responsibilities / Subject
                        </label>
                        <input
                          type="text"
                          value={offResponsibilities}
                          onChange={(e) =>
                            setOffResponsibilities(e.target.value)
                          }
                          placeholder="Responsibilities or academic note..."
                          className="w-full px-3.5 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#161A26] text-[#F3D068] border border-[#D4AF37]/40 text-xs font-medium cursor-pointer">
                          <Upload className="w-3.5 h-3.5" />
                          <span>
                            {offRole === 'Class Teacher'
                              ? 'Upload Class Teacher Photo'
                              : 'Upload Officer Photo'}
                          </span>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                handleFileUpload(file, (uploaded) =>
                                  setOffPhotoUrl(uploaded.fileUrl)
                                );
                              }
                            }}
                          />
                        </label>

                        {STUDIO_PORTRAIT_PRESETS.map((preset) => (
                          <button
                            key={preset.url}
                            type="button"
                            onClick={() => setOffPhotoUrl(preset.url)}
                            className={`px-2.5 py-1.5 rounded-lg text-xs border transition-colors cursor-pointer ${
                              offPhotoUrl === preset.url
                                ? 'bg-[#D4AF37]/20 text-[#F3D068] border-[#D4AF37]'
                                : 'bg-neutral-900 text-neutral-300 border-neutral-800'
                            }`}
                          >
                            {preset.label.split(' ')[0]}{' '}
                            {preset.label.split(' ')[1]}
                          </button>
                        ))}

                        <div className="flex items-center gap-2.5 pl-2">
                          <img
                            src={offPhotoUrl || STUDIO_PORTRAIT_PRESETS[0].url}
                            alt="Selected preview"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).src =
                                STUDIO_PORTRAIT_PRESETS[0].url;
                            }}
                            className="w-12 h-12 rounded-xl object-cover object-top border-2 border-[#D4AF37]"
                          />
                          <div className="text-xs">
                            <div className="font-bold text-white">
                              {offName || 'Enter Name Above'}
                            </div>
                            <div className="text-[11px] text-[#F3D068]">
                              Class {hasGlobalControl ? offClass : lockedClass} ·{' '}
                              {offRole}
                            </div>
                          </div>
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={actionBusy}
                        className="px-5 py-2.5 rounded-lg bg-[#D4AF37] text-neutral-950 font-semibold text-xs cursor-pointer"
                      >
                        {offRole === 'Class Teacher'
                          ? 'Save Class Teacher'
                          : `Save ${offRole}`}
                      </button>
                    </div>
                  </form>

                  {/* Display Class Teacher & 6 Class Officers by Class */}
                  {(hasGlobalControl ? VALID_CLASSES : [lockedClass!]).map(
                    (clsCode) => {
                      const clsOfficers = classOfficersList.filter(
                        (o) => o.classCode === clsCode
                      );
                      const teacherRecord = clsOfficers.find(
                        (o) =>
                          o.roleTitle.trim().toLowerCase() === 'class teacher'
                      );

                      return (
                        <div
                          key={clsCode}
                          className="p-6 rounded-2xl bg-[#0E1118] border border-neutral-800 space-y-5"
                        >
                          <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
                            <div className="flex items-center gap-2.5">
                              <Crown className="w-5 h-5 text-[#D4AF37]" />
                              <h3 className="font-display text-lg font-bold text-white">
                                Class {clsCode} — Class Teacher & Executive Office Bearers
                              </h3>
                            </div>
                            <span className="font-mono-tabular text-xs text-[#F3D068]">
                              {clsOfficers.length} / {CLASS_OFFICER_ROLES.length} Assigned
                            </span>
                          </div>

                          {/* Featured Class Teacher Banner Card */}
                          <div className="p-5 rounded-xl bg-gradient-to-r from-[#141927] via-[#111522] to-[#141927] border-2 border-[#D4AF37]/55 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                              <img
                                src={
                                  teacherRecord?.photoUrl ||
                                  STUDIO_PORTRAIT_PRESETS[1].url
                                }
                                alt={
                                  teacherRecord?.holderName ||
                                  `Class ${clsCode} Teacher`
                                }
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                  (e.currentTarget as HTMLImageElement).src =
                                    STUDIO_PORTRAIT_PRESETS[1].url;
                                }}
                                className="w-16 h-16 rounded-2xl object-cover object-top border-2 border-[#D4AF37] shrink-0 shadow-lg"
                              />
                              <div>
                                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#D4AF37]/20 border border-[#D4AF37]/50 text-[10px] font-bold uppercase tracking-wider text-[#F3D068]">
                                  <GraduationCap className="w-3.5 h-3.5" />
                                  <span>Class {clsCode} · Class Teacher</span>
                                </div>
                                <div className="font-display font-bold text-lg text-white mt-1">
                                  {teacherRecord?.holderName ||
                                    `Class ${clsCode} Teacher (Click Edit to Assign)`}
                                </div>
                                <div className="text-xs text-neutral-300 mt-0.5">
                                  {teacherRecord?.admissionNo && (
                                    <span className="font-mono-tabular text-emerald-300 mr-2">
                                      ID: {teacherRecord.admissionNo}
                                    </span>
                                  )}
                                  <span>
                                    {teacherRecord?.responsibilities ||
                                      `Official Class Teacher & Faculty Advisor for Class ${clsCode}.`}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  setOffClass(clsCode);
                                  setOffRole('Class Teacher');
                                  setOffName(teacherRecord?.holderName || '');
                                  setOffAdmissionNo(
                                    teacherRecord?.admissionNo || ''
                                  );
                                  setOffPhotoUrl(
                                    teacherRecord?.photoUrl ||
                                      STUDIO_PORTRAIT_PRESETS[1].url
                                  );
                                  setOffResponsibilities(
                                    teacherRecord?.responsibilities || ''
                                  );
                                  window.scrollTo({
                                    top: 0,
                                    behavior: 'smooth',
                                  });
                                }}
                                className="px-3.5 py-2 rounded-lg bg-[#D4AF37] text-neutral-950 font-semibold text-xs cursor-pointer"
                              >
                                {teacherRecord
                                  ? 'Edit Class Teacher'
                                  : '+ Add Class Teacher'}
                              </button>
                            </div>
                          </div>

                          {/* 6 Executive Officers Grid (President, VPs, Secretary, Treasurer) */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {CLASS_OFFICER_ROLES.filter(
                              (r) => r !== 'Class Teacher'
                            ).map((roleTitle, idx) => {
                              const officer = clsOfficers.find(
                                (o) =>
                                  o.roleTitle.trim().toLowerCase() ===
                                  roleTitle.trim().toLowerCase()
                              );
                              const fallbackImg =
                                STUDIO_PORTRAIT_PRESETS[
                                  idx % STUDIO_PORTRAIT_PRESETS.length
                                ].url;
                              return (
                                <div
                                  key={roleTitle}
                                  className="p-4 rounded-xl bg-[#121622] border border-neutral-800 hover:border-[#D4AF37]/50 transition-colors flex items-start justify-between gap-3"
                                >
                                  <div className="flex items-center gap-3.5 min-w-0">
                                    <img
                                      src={officer?.photoUrl || fallbackImg}
                                      alt={
                                        officer?.holderName || roleTitle
                                      }
                                      referrerPolicy="no-referrer"
                                      onError={(e) => {
                                        (
                                          e.currentTarget as HTMLImageElement
                                        ).src = fallbackImg;
                                      }}
                                      className="w-14 h-14 rounded-xl object-cover object-top border-2 border-[#D4AF37] shrink-0"
                                    />
                                    <div className="min-w-0">
                                      <div className="text-[10px] font-bold uppercase tracking-wider text-[#F3D068]">
                                        {roleTitle}
                                      </div>
                                      <div className="font-display font-bold text-sm text-white truncate mt-0.5">
                                        {officer?.holderName ||
                                          'Not Assigned Yet'}
                                      </div>
                                      {officer?.admissionNo && (
                                        <div className="text-[11px] font-mono-tabular text-emerald-300 mt-0.5">
                                          Adm No: {officer.admissionNo}
                                        </div>
                                      )}
                                      {officer?.responsibilities && (
                                        <div className="text-[11px] text-neutral-400 line-clamp-1 mt-0.5">
                                          {officer.responsibilities}
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex flex-col gap-1 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOffClass(clsCode);
                                        setOffRole(roleTitle);
                                        setOffName(officer?.holderName || '');
                                        setOffAdmissionNo(
                                          officer?.admissionNo || ''
                                        );
                                        setOffPhotoUrl(
                                          officer?.photoUrl || fallbackImg
                                        );
                                        setOffResponsibilities(
                                          officer?.responsibilities || ''
                                        );
                                        window.scrollTo({
                                          top: 0,
                                          behavior: 'smooth',
                                        });
                                      }}
                                      className="px-2.5 py-1 rounded bg-neutral-900 hover:bg-neutral-800 text-[11px] text-[#F3D068] border border-neutral-700 cursor-pointer"
                                    >
                                      {officer ? 'Edit' : 'Assign'}
                                    </button>
                                    {officer && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setConfirmDelete({
                                            type: 'officer',
                                            id: officer.id,
                                            label: `${officer.roleTitle}: ${officer.holderName} (Class ${officer.classCode})`,
                                          })
                                        }
                                        className="px-2.5 py-1 rounded bg-red-950/40 hover:bg-red-950/80 text-[11px] text-red-300 border border-red-900/40 cursor-pointer"
                                      >
                                        Remove
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    }
                  )}
                </div>
              )}

              {/* ===============================================================
                  SECTION 3: PARTICIPANTS & AUTOMATIC POSTER GENERATION
                 =============================================================== */}
              {activeSection === 'participants' && (
                <div className="space-y-8">
                  <div className="sticky top-0 z-30 -mt-2 py-3 px-4 -mx-4 sm:-mx-8 sm:px-8 bg-[#07080C]/95 backdrop-blur-md border-b border-neutral-800/90 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg">
                    <div>
                      <h1 className="font-display text-2xl font-bold text-white">
                        Participant Management & Automatic Poster Generation
                      </h1>
                      <p className="text-xs sm:text-sm text-neutral-400 mt-0.5">
                        Limits per class: Speech (5), Naat (5), Qirat (1), Table Topic (5), Evolution (5), Aah Counter (1), Marshal (1), Grammarian (1).
                      </p>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingParticipant(null);
                          setPName('');
                          setPAdmissionNo('');
                          setPOwnTopic('');
                          setPDescription('');
                          setShowAddParticipantModal(true);
                        }}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-bold text-xs cursor-pointer shadow-lg shrink-0 transition-transform active:scale-95"
                      >
                        <Plus className="w-4 h-4" />
                        <span>+ Add Participant</span>
                      </button>
                    </div>
                  </div>

                  {/* Add / Edit Participant Form */}
                  <form
                    onSubmit={handleSaveParticipant}
                    className="p-6 rounded-xl bg-[#0E1118] border border-[#D4AF37]/40 space-y-5"
                  >
                    <div className="flex items-center justify-between">
                      <h2 className="font-display text-lg font-bold text-white">
                        {editingParticipant
                          ? `Edit Participant: ${editingParticipant.fullName}`
                          : 'Add Participation (Select Student or Enter Admission No, Name & Class)'}
                      </h2>
                      {editingParticipant && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingParticipant(null);
                            setPName('');
                            setPAdmissionNo('');
                            setPOwnTopic('');
                            setPDescription('');
                          }}
                          className="text-xs text-neutral-400 hover:text-white cursor-pointer"
                        >
                          Cancel Edit
                        </button>
                      )}
                    </div>

                    {/* Quick Fill from Student Roster */}
                    <div className="p-3.5 rounded-xl bg-[#121622] border border-neutral-800">
                      <label className="block text-xs font-medium text-[#F3D068] mb-1.5">
                        Select Student (Quick Fill from Class {formTargetClass} Roster — Optional)
                      </label>
                      <select
                        value=""
                        onChange={(e) => {
                          const stId = Number(e.target.value);
                          const found = studentsList.find((s) => s.id === stId);
                          if (found) {
                            setPName(found.fullName);
                            setPAdmissionNo(found.admissionNo);
                            setPClass(found.classCode);
                            setPPhotoUrl(found.photoUrl);
                          }
                        }}
                        className="w-full px-3.5 py-2 rounded-lg bg-[#0B0D14] border border-neutral-700 text-sm text-white"
                      >
                        <option value="">-- Select a student to auto-fill Name, Admission No & Photo --</option>
                        {studentsList
                          .filter((s) => s.classCode === formTargetClass)
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.fullName} — Admission No: {s.admissionNo} (Class {s.classCode})
                            </option>
                          ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1">
                          Student Name *
                        </label>
                        <input
                          type="text"
                          required
                          value={pName}
                          onChange={(e) => setPName(e.target.value)}
                          placeholder="Enter full name"
                          className="w-full px-3.5 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white focus:border-[#D4AF37] focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1">
                          Admission No *
                        </label>
                        <input
                          type="text"
                          required
                          value={pAdmissionNo}
                          onChange={(e) => setPAdmissionNo(e.target.value)}
                          placeholder="e.g. ADM-U1-101"
                          className="w-full px-3.5 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white font-mono focus:border-[#D4AF37] focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1">
                          Class Cohort (U1–U6) *
                        </label>
                        <select
                          value={hasGlobalControl ? pClass : lockedClass!}
                          disabled={!hasGlobalControl}
                          onChange={(e) =>
                            setPClass(e.target.value as ClassCode)
                          }
                          className="w-full px-3.5 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white focus:border-[#D4AF37] focus:outline-none disabled:opacity-60"
                        >
                          {VALID_CLASSES.map((c) => (
                            <option key={c} value={c}>
                              Class {c}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1">
                          Category *
                        </label>
                        <select
                          value={pCategory}
                          onChange={(e) =>
                            setPCategory(
                              e.target.value as CompetitionCategoryName
                            )
                          }
                          className="w-full px-3.5 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white focus:border-[#D4AF37] focus:outline-none"
                        >
                          {COMPETITION_CATEGORIES.map((cat) => {
                            const count = participantsList.filter(
                              (p) =>
                                p.classCode === formTargetClass &&
                                p.categoryName === cat
                            ).length;
                            const max = CATEGORY_MAX[cat];
                            return (
                              <option key={cat} value={cat}>
                                {cat} ({count}/{max} filled)
                              </option>
                            );
                          })}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1">
                          Own Topic (Speech, Naat, Qirat, etc.)
                        </label>
                        <input
                          type="text"
                          value={pOwnTopic}
                          onChange={(e) => setPOwnTopic(e.target.value)}
                          placeholder="Enter participant's specific topic"
                          className="w-full px-3.5 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white focus:border-[#D4AF37] focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Photograph Upload or Studio Portrait Selection */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center pt-2">
                      <div className="lg:col-span-7">
                        <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                          Participant Photograph (Upload Custom Photo or Choose Studio Portrait)
                        </label>
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#161A26] hover:bg-[#1E2436] text-[#F3D068] border border-[#D4AF37]/40 text-xs font-medium cursor-pointer">
                            <Upload className="w-3.5 h-3.5" />
                            <span>Upload Photo File</span>
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  handleFileUpload(file, (uploaded) =>
                                    setPPhotoUrl(uploaded.fileUrl)
                                  );
                                }
                              }}
                            />
                          </label>
                          {STUDIO_PORTRAIT_PRESETS.map((preset) => (
                            <button
                              key={preset.url}
                              type="button"
                              onClick={() => setPPhotoUrl(preset.url)}
                              className={`px-2.5 py-1.5 rounded-lg text-xs border transition-colors cursor-pointer ${
                                pPhotoUrl === preset.url
                                  ? 'bg-[#D4AF37]/20 text-[#F3D068] border-[#D4AF37]'
                                  : 'bg-neutral-900 text-neutral-300 border-neutral-800'
                              }`}
                            >
                              {preset.label.split(' ')[0]}{' '}
                              {preset.label.split(' ')[1]}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="lg:col-span-5 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <img
                            src={pPhotoUrl}
                            alt="Selected scholar preview"
                            referrerPolicy="no-referrer"
                            className="w-12 h-12 rounded-lg object-cover object-top border border-[#D4AF37]"
                          />
                          <div className="text-xs">
                            <div className="font-semibold text-white">
                              {formTargetClass} · {pCategory}
                            </div>
                            <div
                              className={`font-mono-tabular ${
                                isFormCategoryAtCapacity
                                  ? 'text-amber-400 font-semibold'
                                  : 'text-neutral-400'
                              }`}
                            >
                              {currentCategoryRegisteredCount} /{' '}
                              {currentCategoryLimit} Registered (
                              {Math.max(
                                0,
                                currentCategoryLimit -
                                  currentCategoryRegisteredCount
                              )}{' '}
                              remaining)
                            </div>
                          </div>
                        </div>

                        <button
                          type="submit"
                          disabled={actionBusy || isFormCategoryAtCapacity}
                          className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-[#C89D2E] via-[#E8C55B] to-[#C89D2E] text-neutral-950 font-semibold text-xs whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40"
                        >
                          {actionBusy
                            ? 'Saving & Generating...'
                            : editingParticipant
                            ? 'Update & Regenerate Poster'
                            : 'Add Participant & Generate Poster'}
                        </button>
                      </div>
                    </div>

                    {isFormCategoryAtCapacity && (
                      <div className="p-3 rounded-lg bg-amber-950/50 border border-amber-600/50 flex items-center gap-2 text-xs text-amber-200">
                        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                        <span>
                          Capacity Warning: <strong>{pCategory}</strong> in Class{' '}
                          <strong>{formTargetClass}</strong> has reached its maximum limit of{' '}
                          <strong>{currentCategoryLimit}</strong> participant(s). Additional registrations in this category are blocked unless an existing record is removed or reassigned.
                        </span>
                      </div>
                    )}
                  </form>

                  {/* Auto-Generated Poster Preview Banner */}
                  {latestGeneratedPoster && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[#F3D068] uppercase tracking-wider">
                          Latest Automatically Generated Poster Preview
                        </span>
                        <button
                          type="button"
                          onClick={() => setLatestGeneratedPoster(null)}
                          className="text-xs text-neutral-400 hover:text-white cursor-pointer"
                        >
                          Hide Preview
                        </button>
                      </div>
                      <PosterStageCard
                        poster={latestGeneratedPoster}
                        liveParticipants={participantsList}
                        canManage={true}
                        onOpenStudio={(p) => setStudioPoster(p)}
                        onPostToFeed={(p) => handlePostPosterToFeed(p)}
                        onPosterUpdated={() => {
                          fetchDashboardData();
                          onPublicDataChanged();
                        }}
                      />
                    </div>
                  )}

                  {/* Participant Roster Table with Filters */}
                  <div className="rounded-xl bg-[#0E1118] border border-neutral-800 overflow-hidden">
                    <div className="p-4 border-b border-neutral-800 flex flex-wrap items-center justify-between gap-3">
                      <h3 className="font-display font-bold text-base text-white">
                        Registered Participants ({participantsList.length})
                      </h3>

                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search participant name..."
                          className="px-3 py-1.5 rounded-lg bg-[#12151F] border border-neutral-700 text-xs text-white"
                        />
                        {hasGlobalControl && (
                          <select
                            value={selectedClassFilter}
                            onChange={(e) =>
                              setSelectedClassFilter(
                                e.target.value as 'ALL' | ClassCode
                              )
                            }
                            className="px-3 py-1.5 rounded-lg bg-[#12151F] border border-neutral-700 text-xs text-white"
                          >
                            <option value="ALL">All Classes (U1–U6)</option>
                            {VALID_CLASSES.map((c) => (
                              <option key={c} value={c}>
                                Class {c}
                              </option>
                            ))}
                          </select>
                        )}
                        <select
                          value={selectedCategoryFilter}
                          onChange={(e) =>
                            setSelectedCategoryFilter(
                              e.target.value as 'ALL' | CompetitionCategoryName
                            )
                          }
                          className="px-3 py-1.5 rounded-lg bg-[#12151F] border border-neutral-700 text-xs text-white"
                        >
                          <option value="ALL">All Categories</option>
                          {COMPETITION_CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-neutral-800 text-xs text-neutral-400 uppercase">
                            <th className="py-3 px-4">Scholar</th>
                            <th className="py-3 px-4">Admission No</th>
                            <th className="py-3 px-4">Class</th>
                            <th className="py-3 px-4">Competition Category</th>
                            <th className="py-3 px-4">Own Topic / Notes</th>
                            <th className="py-3 px-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-800/80 text-sm">
                          {participantsList
                            .filter((p) => {
                              if (
                                hasGlobalControl &&
                                selectedClassFilter !== 'ALL' &&
                                p.classCode !== selectedClassFilter
                              )
                                return false;
                              if (
                                selectedCategoryFilter !== 'ALL' &&
                                p.categoryName !== selectedCategoryFilter
                              )
                                return false;
                              if (
                                searchQuery.trim() &&
                                !p.fullName
                                  .toLowerCase()
                                  .includes(searchQuery.toLowerCase()) &&
                                !(p.admissionNo || '')
                                  .toLowerCase()
                                  .includes(searchQuery.toLowerCase())
                              )
                                return false;
                              return true;
                            })
                            .map((p) => (
                              <tr key={p.id} className="hover:bg-[#141824]">
                                <td className="py-3 px-4">
                                  <div className="flex items-center gap-3">
                                    <img
                                      src={p.photoUrl}
                                      alt={p.fullName}
                                      referrerPolicy="no-referrer"
                                      className="w-9 h-9 rounded-lg object-cover object-top border border-[#D4AF37]/50"
                                    />
                                    <span className="font-semibold text-white">
                                      {p.fullName}
                                    </span>
                                  </div>
                                </td>
                                <td className="py-3 px-4 font-mono-tabular text-xs text-emerald-300">
                                  {p.admissionNo || '—'}
                                </td>
                                <td className="py-3 px-4 font-mono-tabular text-xs text-[#F3D068]">
                                  {p.classCode}
                                </td>
                                <td className="py-3 px-4 text-xs text-neutral-200">
                                  {p.categoryName}
                                </td>
                                <td className="py-3 px-4 text-xs text-neutral-400 max-w-xs truncate">
                                  {p.ownTopic || p.shortDescription || '—'}
                                </td>
                                <td className="py-3 px-4 text-right">
                                  <div className="inline-flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingParticipant(p);
                                        setPName(p.fullName);
                                        setPAdmissionNo(p.admissionNo || '');
                                        setPOwnTopic(p.ownTopic || '');
                                        setPClass(p.classCode);
                                        setPCategory(p.categoryName);
                                        setPPhotoUrl(p.photoUrl);
                                        setPDescription(
                                          p.shortDescription || ''
                                        );
                                      }}
                                      className="px-2.5 py-1 rounded bg-neutral-900 hover:bg-neutral-800 text-xs text-neutral-200 border border-neutral-700 cursor-pointer"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setConfirmDelete({
                                          type: 'participant',
                                          id: p.id,
                                          label: `${p.fullName} (${p.classCode} · ${p.categoryName})`,
                                        })
                                      }
                                      className="px-2.5 py-1 rounded bg-red-950/40 hover:bg-red-950/80 text-xs text-red-300 border border-red-900/50 cursor-pointer"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* ===============================================================
                  SECTION 4: COMPETITION CATEGORIES & EXACT PARTICIPANT LIMITS
                 =============================================================== */}
              {activeSection === 'categories' && (
                <div className="space-y-6">
                  <div>
                    <h1 className="font-display text-2xl font-bold text-white">
                      Competition Categories & Exact Participant Limits
                    </h1>
                    <p className="text-sm text-neutral-400 mt-1">
                      Strict backend-enforced capacity limits per class: Qirat (1), Naat (5), Speech (5), Table Topic (5), Evolution (5), Aah Counter (1), Marshal (1), and Grammarian (1).
                    </p>
                  </div>

                  <div className="rounded-xl bg-[#0E1118] border border-neutral-800 overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-neutral-800 text-xs text-neutral-400 uppercase">
                          <th className="py-3.5 px-5">Category Name</th>
                          <th className="py-3.5 px-5">Max Per Class</th>
                          {(hasGlobalControl ? VALID_CLASSES : [lockedClass!]).map(
                            (cls) => (
                              <th key={cls} className="py-3.5 px-5">
                                Class {cls}
                              </th>
                            )
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-800 text-sm">
                        {COMPETITION_CATEGORIES.map((cat) => {
                          const max = CATEGORY_MAX[cat];
                          return (
                            <tr key={cat} className="hover:bg-[#141824]">
                              <td className="py-4 px-5 font-display font-bold text-white">
                                {cat}
                              </td>
                              <td className="py-4 px-5 font-mono-tabular text-xs text-[#F3D068]">
                                {max} Max
                              </td>
                              {(hasGlobalControl
                                ? VALID_CLASSES
                                : [lockedClass!]
                              ).map((cls) => {
                                const count = participantsList.filter(
                                  (p) =>
                                    p.classCode === cls &&
                                    p.categoryName === cat
                                ).length;
                                const remaining = Math.max(0, max - count);
                                const isFull = count >= max;
                                return (
                                  <td
                                    key={cls}
                                    className="py-4 px-5 font-mono-tabular text-xs"
                                  >
                                    <div
                                      className={`font-semibold ${
                                        isFull
                                          ? 'text-amber-300'
                                          : 'text-neutral-200'
                                      }`}
                                    >
                                      {count} / {max}
                                    </div>
                                    <div className="text-[11px] text-neutral-500">
                                      {isFull
                                        ? 'Full (0 left)'
                                        : `${remaining} left`}
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ===============================================================
                  SECTION 5: POSTERS MANAGEMENT
                 =============================================================== */}
              {activeSection === 'posters' && (
                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h1 className="font-display text-2xl font-bold text-white">
                        Generated Competition Posters
                      </h1>
                      <p className="text-sm text-neutral-400 mt-1">
                        Preview, regenerate, download high-res PNGs, and control publication visibility for generated posters.
                      </p>
                    </div>

                    {hasGlobalControl && (
                      <div className="flex items-center gap-2">
                        <select
                          value={selectedClassFilter}
                          onChange={(e) =>
                            setSelectedClassFilter(
                              e.target.value as 'ALL' | ClassCode
                            )
                          }
                          className="px-3.5 py-2 rounded-lg bg-[#0E1118] border border-neutral-700 text-xs text-white"
                        >
                          <option value="ALL">All Classes (U1–U6)</option>
                          {VALID_CLASSES.map((c) => (
                            <option key={c} value={c}>
                              Class {c}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            const targetClass =
                              selectedClassFilter === 'ALL'
                                ? 'U1'
                                : selectedClassFilter;
                            handleRegeneratePoster(targetClass, 'All Categories');
                          }}
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#D4AF37] text-neutral-950 font-semibold text-xs cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add / Refresh Poster</span>
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                    {postersList
                      .filter(
                        (p) =>
                          !hasGlobalControl ||
                          selectedClassFilter === 'ALL' ||
                          p.classCode === selectedClassFilter
                      )
                      .map((poster) => (
                        <div key={poster.id} className="space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#0E1118] border border-neutral-800 text-xs">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-[#F3D068]">
                                Class {poster.classCode} · {poster.categoryName}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="text-neutral-300">
                                Status: {poster.publicationStatus}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  handleRegeneratePoster(
                                    poster.classCode,
                                    poster.categoryName
                                  )
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-neutral-900 hover:bg-neutral-800 text-neutral-200 border border-neutral-700 cursor-pointer"
                              >
                                <RefreshCw className="w-3 h-3 text-[#D4AF37]" />
                                <span>Regenerate</span>
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmDelete({
                                    type: 'poster',
                                    id: poster.id,
                                    label: `Class ${poster.classCode} Poster`,
                                  })
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-red-950/80 hover:bg-red-900 text-red-200 border border-red-700 cursor-pointer"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Delete</span>
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleTogglePosterStatus(poster)
                                }
                                className="px-2.5 py-1 rounded bg-neutral-900 hover:bg-neutral-800 text-neutral-200 border border-neutral-700 cursor-pointer"
                              >
                                {poster.publicationStatus === 'PUBLISHED'
                                  ? 'Hide from Public'
                                  : 'Publish Poster'}
                              </button>
                            </div>
                          </div>
                          <PosterStageCard
                            poster={poster}
                            liveParticipants={participantsList}
                            canManage={true}
                            onOpenStudio={(target) => setStudioPoster(target)}
                            onPostToFeed={(target) =>
                              handlePostPosterToFeed(target)
                            }
                            onPosterUpdated={() => {
                              fetchDashboardData();
                              onPublicDataChanged();
                            }}
                          />
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* ===============================================================
                  SECTION 6: CLASS FEED & SUPER ADMIN CONTENT MODERATION
                 =============================================================== */}
              {activeSection === 'feed' && (
                <div className="space-y-8">
                  <div>
                    <h1 className="font-display text-2xl font-bold text-white">
                      {hasGlobalControl
                        ? 'Class Feed Submissions & Content Moderation'
                        : `Class ${lockedClass} Feed Submissions`}
                    </h1>
                    <p className="text-sm text-neutral-400 mt-1">
                      {hasGlobalControl
                        ? 'Review pending Class Admin submissions. Approved posts become immediately visible and downloadable on the public website.'
                        : 'Submit class photos, posters, and announcements for review. Rejected posts can be edited and resubmitted.'}
                    </p>
                  </div>

                  {/* Submit / Edit Feed Post Form */}
                  <form
                    onSubmit={handleSaveFeedPost}
                    className="p-6 rounded-xl bg-[#0E1118] border border-neutral-800 space-y-4"
                  >
                    <div className="flex items-center justify-between">
                      <h2 className="font-display text-base font-bold text-white">
                        {editingFeedPost
                          ? `Edit & Resubmit Post: ${editingFeedPost.title}`
                          : hasGlobalControl
                          ? 'Publish Direct Class Feed Post'
                          : `Submit New Class ${lockedClass} Post for Approval`}
                      </h2>
                      {editingFeedPost && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingFeedPost(null);
                            setFTitle('');
                            setFCaption('');
                          }}
                          className="text-xs text-neutral-400 hover:text-white cursor-pointer"
                        >
                          Cancel Edit
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1">
                          Post Title *
                        </label>
                        <input
                          type="text"
                          required
                          value={fTitle}
                          onChange={(e) => setFTitle(e.target.value)}
                          placeholder="e.g., Weekly Speech Competition Highlights"
                          className="w-full px-3.5 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1">
                          Class (U1–U6) *
                        </label>
                        <select
                          value={hasGlobalControl ? fClass : lockedClass!}
                          disabled={!hasGlobalControl}
                          onChange={(e) =>
                            setFClass(e.target.value as ClassCode)
                          }
                          className="w-full px-3.5 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white disabled:opacity-60"
                        >
                          {VALID_CLASSES.map((c) => (
                            <option key={c} value={c}>
                              Class {c}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1">
                          Content Type
                        </label>
                        <select
                          value={fMediaType}
                          onChange={(e) =>
                            setFMediaType(
                              e.target.value as
                                | 'PHOTO'
                                | 'POSTER'
                                | 'ANNOUNCEMENT'
                            )
                          }
                          className="w-full px-3.5 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white"
                        >
                          <option value="PHOTO">Photograph</option>
                          <option value="POSTER">Competition Poster</option>
                          <option value="ANNOUNCEMENT">
                            Class Announcement
                          </option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-neutral-300 mb-1">
                        Caption / Educational Announcement *
                      </label>
                      <textarea
                        rows={2}
                        required
                        value={fCaption}
                        onChange={(e) => setFCaption(e.target.value)}
                        placeholder="Describe the class activity or scholar achievement..."
                        className="w-full px-3.5 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white"
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <label className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#161A26] text-[#F3D068] border border-[#D4AF37]/40 text-xs font-medium cursor-pointer">
                          <Upload className="w-3.5 h-3.5" />
                          <span>Upload Media Image</span>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                handleFileUpload(file, (uploaded) =>
                                  setFMediaUrl(uploaded.fileUrl)
                                );
                              }
                            }}
                          />
                        </label>
                        <img
                          src={fMediaUrl}
                          alt="Feed media preview"
                          referrerPolicy="no-referrer"
                          className="w-10 h-10 rounded object-cover border border-neutral-700"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={actionBusy}
                        className="px-5 py-2.5 rounded-lg bg-[#D4AF37] text-neutral-950 font-semibold text-xs cursor-pointer"
                      >
                        {editingFeedPost
                          ? 'Save & Resubmit for Approval'
                          : hasGlobalControl
                          ? 'Publish Feed Post'
                          : 'Submit for Review'}
                      </button>
                    </div>
                  </form>

                  {/* Submissions List & Moderation Queue */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {feedList.map((post) => (
                      <div
                        key={post.id}
                        className="p-5 rounded-xl bg-[#0E1118] border border-neutral-800 flex flex-col justify-between gap-4"
                      >
                        <div className="flex items-start gap-4">
                          <img
                            src={post.mediaUrl}
                            alt={post.title}
                            referrerPolicy="no-referrer"
                            className="w-24 h-24 rounded-lg object-cover object-top border border-neutral-700 shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-xs">
                              <span className="font-semibold text-[#F3D068]">
                                Class {post.classCode}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span
                                className={`font-semibold ${
                                  post.status === 'APPROVED'
                                    ? 'text-emerald-400'
                                    : post.status === 'REJECTED'
                                    ? 'text-red-400'
                                    : 'text-amber-300'
                                }`}
                              >
                                {post.status}
                              </span>
                            </div>
                            <h3 className="font-display font-bold text-base text-white mt-1">
                              {post.title}
                            </h3>
                            <p className="text-xs text-neutral-300 mt-1">
                              {post.caption}
                            </p>
                            {post.rejectionReason && (
                              <p className="text-xs text-red-300 mt-2 bg-red-950/40 p-2 rounded border border-red-900/50">
                                Rejection Reason: {post.rejectionReason}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="pt-3 border-t border-neutral-800 space-y-2">
                          {hasGlobalControl && post.status === 'PENDING' && (
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="text"
                                value={rejectionNotes[post.id] || ''}
                                onChange={(e) =>
                                  setRejectionNotes((prev) => ({
                                    ...prev,
                                    [post.id]: e.target.value,
                                  }))
                                }
                                placeholder="Optional rejection feedback..."
                                className="flex-1 px-3 py-1.5 rounded bg-[#12151F] border border-neutral-700 text-xs text-white"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  handleModerateFeedPost(post.id, 'APPROVED')
                                }
                                className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs cursor-pointer"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleModerateFeedPost(post.id, 'REJECTED')
                                }
                                className="px-3 py-1.5 rounded bg-red-700 hover:bg-red-600 text-white font-semibold text-xs cursor-pointer"
                              >
                                Reject
                              </button>
                            </div>
                          )}

                          <div className="flex items-center justify-between text-xs text-neutral-400">
                            <span>By {post.submittedByName}</span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingFeedPost(post);
                                  setFClass(post.classCode);
                                  setFTitle(post.title);
                                  setFCaption(post.caption);
                                  setFMediaUrl(post.mediaUrl);
                                  setFMediaType(post.mediaType);
                                }}
                                className="text-[#F3D068] hover:underline cursor-pointer"
                              >
                                {post.status === 'REJECTED'
                                  ? 'Edit & Resubmit'
                                  : 'Edit'}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmDelete({
                                    type: 'feed',
                                    id: post.id,
                                    label: post.title,
                                  })
                                }
                                className="text-red-400 hover:underline cursor-pointer"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ===============================================================
                  SECTION 7: OFFICIAL WEEKLY RESULTS
                 =============================================================== */}
              {activeSection === 'results' && (
                <div className="space-y-8">
                  <div>
                    <h1 className="font-display text-2xl font-bold text-white">
                      Official Weekly Results (Best Speaker & Best Naat)
                    </h1>
                    <p className="text-sm text-neutral-400 mt-1">
                      {hasGlobalControl
                        ? 'Publish official weekly winners for Best Speaker and Best Naat. Past results are permanently preserved in the public historical archive.'
                        : 'View official weekly results published by the Super Admin & Teachers.'}
                    </p>
                  </div>

                  {hasGlobalControl && (
                    <form
                      onSubmit={handlePublishWeeklyResult}
                      className="p-6 rounded-xl bg-[#0E1118] border border-[#D4AF37]/40 space-y-4"
                    >
                      <h2 className="font-display text-lg font-bold text-white">
                        Publish Official Weekly Result
                      </h2>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-neutral-300 mb-1">
                            Result Category *
                          </label>
                          <select
                            value={rCategory}
                            onChange={(e) =>
                              setRCategory(
                                e.target.value as 'Best Speaker' | 'Best Naat'
                              )
                            }
                            className="w-full px-3 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white"
                          >
                            <option value="Best Speaker">Best Speaker</option>
                            <option value="Best Naat">Best Naat</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-neutral-300 mb-1">
                            Winner Name *
                          </label>
                          <input
                            type="text"
                            required
                            value={rWinnerName}
                            onChange={(e) => setRWinnerName(e.target.value)}
                            placeholder="e.g., Ayesha Khan"
                            className="w-full px-3 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-neutral-300 mb-1">
                            Winner Class (U1–U6) *
                          </label>
                          <select
                            value={rWinnerClass}
                            onChange={(e) =>
                              setRWinnerClass(e.target.value as ClassCode)
                            }
                            className="w-full px-3 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white"
                          >
                            {VALID_CLASSES.map((c) => (
                              <option key={c} value={c}>
                                Class {c}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-neutral-300 mb-1">
                            Week Period *
                          </label>
                          <input
                            type="text"
                            required
                            value={rWeekLabel}
                            onChange={(e) => setRWeekLabel(e.target.value)}
                            placeholder="Week 13 – 27 Apr 2025"
                            className="w-full px-3 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-neutral-300 mb-1">
                            Result Date *
                          </label>
                          <input
                            type="date"
                            required
                            value={rDate}
                            onChange={(e) => setRDate(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
                        <div className="lg:col-span-6">
                          <label className="block text-xs font-medium text-neutral-300 mb-1">
                            Citation Remarks (Optional)
                          </label>
                          <input
                            type="text"
                            value={rRemarks}
                            onChange={(e) => setRRemarks(e.target.value)}
                            placeholder="Awarded for exemplary delivery and clarity..."
                            className="w-full px-3 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white"
                          />
                        </div>

                        <div className="lg:col-span-6 flex flex-wrap items-center justify-between gap-3 pt-4">
                          <div className="flex items-center gap-2">
                            <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#161A26] text-[#F3D068] border border-[#D4AF37]/40 text-xs font-medium cursor-pointer">
                              <Upload className="w-3.5 h-3.5" />
                              <span>Upload Winner Photo</span>
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) {
                                    handleFileUpload(file, (uploaded) =>
                                      setRWinnerPhoto(uploaded.fileUrl)
                                    );
                                  }
                                }}
                              />
                            </label>
                            <img
                              src={rWinnerPhoto}
                              alt="Winner preview"
                              referrerPolicy="no-referrer"
                              className="w-10 h-10 rounded-full object-cover border border-[#D4AF37]"
                            />
                          </div>

                          <button
                            type="submit"
                            disabled={actionBusy}
                            className="px-5 py-2.5 rounded-lg bg-[#D4AF37] text-neutral-950 font-semibold text-xs cursor-pointer"
                          >
                            Publish Official Result
                          </button>
                        </div>
                      </div>
                    </form>
                  )}

                  {/* Historical Results Table */}
                  <div className="rounded-xl bg-[#0E1118] border border-neutral-800 overflow-hidden">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-neutral-800 text-xs text-neutral-400 uppercase">
                          <th className="py-3 px-4">Winner</th>
                          <th className="py-3 px-4">Category</th>
                          <th className="py-3 px-4">Class</th>
                          <th className="py-3 px-4">Week / Date</th>
                          <th className="py-3 px-4">Remarks</th>
                          {hasGlobalControl && (
                            <th className="py-3 px-4 text-right">Actions</th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-800 text-sm">
                        {resultsList.map((r) => (
                          <tr key={r.id} className="hover:bg-[#141824]">
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-3">
                                <img
                                  src={r.winnerPhotoUrl}
                                  alt={r.winnerName}
                                  referrerPolicy="no-referrer"
                                  className="w-9 h-9 rounded-full object-cover object-top border border-[#D4AF37]/50"
                                />
                                <span className="font-semibold text-white">
                                  {r.winnerName}
                                </span>
                              </div>
                            </td>
                            <td className="py-3 px-4 text-xs text-[#F3D068] font-semibold">
                              {r.resultCategory}
                            </td>
                            <td className="py-3 px-4 font-mono-tabular text-xs text-white">
                              {r.winnerClass}
                            </td>
                            <td className="py-3 px-4 font-mono-tabular text-xs text-neutral-300">
                              {r.weekLabel}
                            </td>
                            <td className="py-3 px-4 text-xs text-neutral-400 max-w-xs truncate">
                              {r.remarks || '—'}
                            </td>
                            {hasGlobalControl && (
                              <td className="py-3 px-4 text-right">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setConfirmDelete({
                                      type: 'result',
                                      id: r.id,
                                      label: `${r.resultCategory}: ${r.winnerName} (${r.weekLabel})`,
                                    })
                                  }
                                  className="text-xs text-red-400 hover:underline cursor-pointer"
                                >
                                  Delete
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ===============================================================
                  SECTION 8 & 9: COMMON LIBRARY & CLASS LIBRARIES
                 =============================================================== */}
              {(activeSection === 'common-library' ||
                activeSection === 'class-libraries') && (
                <div className="space-y-8">
                  <div>
                    <h1 className="font-display text-2xl font-bold text-white">
                      {activeSection === 'common-library'
                        ? 'Common Public Digital Library Management'
                        : hasGlobalControl
                        ? 'Class Libraries Management (U1 – U6)'
                        : `Class ${lockedClass} Digital Library Management`}
                    </h1>
                    <p className="text-sm text-neutral-400 mt-1">
                      Upload and manage educational resources across all 11 exact categories: Books, Articles, Journals, Research Papers, Notes, Presentations, Videos, Images, Audio, Code Snippets, and Bookmarks.
                    </p>
                  </div>

                  {/* Upload Library Resource Form */}
                  <form
                    onSubmit={(e) =>
                      handleAddLibraryResource(
                        e,
                        activeSection === 'common-library'
                          ? 'COMMON'
                          : hasGlobalControl
                          ? lScope === 'COMMON'
                            ? 'U2'
                            : lScope
                          : lockedClass!
                      )
                    }
                    className="p-6 rounded-xl bg-[#0E1118] border border-neutral-800 space-y-4"
                  >
                    <h2 className="font-display text-base font-bold text-white">
                      Add New Digital Library Resource
                    </h2>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1">
                          Resource Title *
                        </label>
                        <input
                          type="text"
                          required
                          value={lTitle}
                          onChange={(e) => setLTitle(e.target.value)}
                          placeholder="e.g., Principles of Oratory"
                          className="w-full px-3 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1">
                          Resource Category (11 Exact Types) *
                        </label>
                        <select
                          value={lCategory}
                          onChange={(e) =>
                            setLCategory(e.target.value as LibraryCategoryName)
                          }
                          className="w-full px-3 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white"
                        >
                          {LIBRARY_CATEGORIES.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1">
                          Library Target *
                        </label>
                        {activeSection === 'common-library' ? (
                          <input
                            type="text"
                            disabled
                            value="Common Public Library"
                            className="w-full px-3 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-neutral-400"
                          />
                        ) : (
                          <select
                            value={
                              hasGlobalControl
                                ? lScope === 'COMMON'
                                  ? 'U2'
                                  : lScope
                                : lockedClass!
                            }
                            disabled={!hasGlobalControl}
                            onChange={(e) =>
                              setLScope(e.target.value as ClassCode)
                            }
                            className="w-full px-3 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white disabled:opacity-60"
                          >
                            {VALID_CLASSES.map((c) => (
                              <option key={c} value={c}>
                                Class {c} Library
                              </option>
                            ))}
                          </select>
                        )}
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1">
                          Author / Instructor *
                        </label>
                        <input
                          type="text"
                          required
                          value={lAuthor}
                          onChange={(e) => setLAuthor(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1">
                          Description *
                        </label>
                        <textarea
                          rows={2}
                          required
                          value={lDescription}
                          onChange={(e) => setLDescription(e.target.value)}
                          placeholder="Summary of the resource..."
                          className="w-full px-3 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1">
                          Embedded Preview Text / Code Snippet / Bookmark URL
                        </label>
                        <textarea
                          rows={2}
                          value={lContentPreview}
                          onChange={(e) => setLContentPreview(e.target.value)}
                          placeholder="Paste excerpt, code snippet, or URL for instant in-app preview..."
                          className="w-full px-3 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white font-mono"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <label className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#161A26] text-[#F3D068] border border-[#D4AF37]/40 text-xs font-medium cursor-pointer">
                          <Upload className="w-3.5 h-3.5" />
                          <span>Upload Resource File</span>
                          <input
                            type="file"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                handleFileUpload(file, (uploaded) => {
                                  setLFileUrl(uploaded.fileUrl);
                                  setLFileType(uploaded.fileType);
                                  setLFileSize(uploaded.fileSize);
                                });
                              }
                            }}
                          />
                        </label>
                        {lFileUrl && (
                          <span className="text-xs text-emerald-300 font-mono-tabular">
                            Attached: {lFileType} ({lFileSize})
                          </span>
                        )}
                      </div>

                      <button
                        type="submit"
                        disabled={actionBusy}
                        className="px-5 py-2.5 rounded-lg bg-[#D4AF37] text-neutral-950 font-semibold text-xs cursor-pointer"
                      >
                        Publish Resource to Library
                      </button>
                    </div>
                  </form>

                  {/* Existing Library Items */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {libraryList
                      .filter((item) =>
                        activeSection === 'common-library'
                          ? item.libraryScope === 'COMMON'
                          : hasGlobalControl
                          ? item.libraryScope !== 'COMMON'
                          : item.libraryScope === lockedClass
                      )
                      .map((res) => (
                        <div
                          key={res.id}
                          className="p-5 rounded-xl bg-[#0E1118] border border-neutral-800 flex items-start justify-between gap-4"
                        >
                          <div className="min-w-0">
                            <div className="text-xs text-[#F3D068] font-semibold">
                              {res.category} ·{' '}
                              {res.libraryScope === 'COMMON'
                                ? 'Common Library'
                                : `Class ${res.libraryScope}`}{' '}
                              · {res.fileType} ({res.fileSize})
                            </div>
                            <h3 className="font-display font-bold text-base text-white mt-1">
                              {res.title}
                            </h3>
                            <p className="text-xs text-neutral-400 mt-1">
                              {res.description}
                            </p>
                            <div className="mt-3 flex items-center gap-2 flex-wrap">
                              <span className="text-[10px] uppercase tracking-wide text-neutral-400">
                                Public
                              </span>
                              <button
                                type="button"
                                onClick={() => handleToggleLibraryResourceStatus(res)}
                                className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border cursor-pointer ${
                                  res.publicationStatus === 'PUBLISHED'
                                    ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700/50'
                                    : 'bg-neutral-900 text-neutral-300 border-neutral-700'
                                }`}
                              >
                                {res.publicationStatus === 'PUBLISHED' ? 'ON' : 'OFF'}
                              </button>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setConfirmDelete({
                                type: 'library',
                                id: res.id,
                                label: res.title,
                              })
                            }
                            className="text-xs text-red-400 hover:underline shrink-0 cursor-pointer"
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* ===============================================================
                  SECTION 10: USERS / ADMIN MANAGEMENT (SUPER ADMIN ONLY)
                 =============================================================== */}
              {activeSection === 'users' && isSuperAdmin && (
                <div className="space-y-8">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h1 className="font-display text-2xl font-bold text-white">
                        Users, Gmail & Password Management
                      </h1>
                      <p className="text-sm text-neutral-400 mt-1">
                        View every user’s Gmail and Password, change their Role (Super Admin / Class Admin) or Assigned Class (U1–U6), edit Gmail & Password, or delete accounts.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-950/40 border border-emerald-700/40 text-xs text-emerald-300">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>Firebase Connected · ImgBB Image Hosting Active</span>
                    </div>
                  </div>

                  {/* Create / Add New User Form */}
                  <form
                    onSubmit={handleCreateAdminUser}
                    className="p-6 rounded-xl bg-[#0E1118] border border-[#D4AF37]/40 space-y-4"
                  >
                    <h2 className="font-display text-lg font-bold text-white">
                      Add New User (Gmail & Password)
                    </h2>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1">
                          Full Name *
                        </label>
                        <input
                          type="text"
                          required
                          value={uName}
                          onChange={(e) => setUName(e.target.value)}
                          placeholder="Prof. Imran Ali"
                          className="w-full px-3 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1">
                          Gmail Address *
                        </label>
                        <input
                          type="email"
                          required
                          value={uEmail}
                          onChange={(e) => setUEmail(e.target.value)}
                          placeholder="example@gmail.com"
                          className="w-full px-3 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1">
                          Role *
                        </label>
                        <select
                          value={uRole}
                          onChange={(e) =>
                            setURole(
                              e.target.value as
                                | 'SUPER_ADMIN'
                                | 'TEACHER'
                                | 'CLASS_ADMIN'
                            )
                          }
                          className="w-full px-3 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white"
                        >
                          <option value="CLASS_ADMIN">Class Admin</option>
                          <option value="TEACHER">Teacher (Full Control except Users)</option>
                          <option value="SUPER_ADMIN">Super Admin</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1">
                          Assigned Class (U1–U6)
                        </label>
                        <select
                          value={uAssignedClass}
                          disabled={uRole === 'SUPER_ADMIN' || uRole === 'TEACHER'}
                          onChange={(e) =>
                            setUAssignedClass(e.target.value as ClassCode)
                          }
                          className="w-full px-3 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white disabled:opacity-50"
                        >
                          {VALID_CLASSES.map((c) => (
                            <option key={c} value={c}>
                              Class {c}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1">
                          Password *
                        </label>
                        <input
                          type="text"
                          required
                          value={uPassword}
                          onChange={(e) => setUPassword(e.target.value)}
                          placeholder="Enter password"
                          className="w-full px-3 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white font-mono"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                      <label className="inline-flex items-center gap-2 text-xs text-neutral-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={uReplaceExisting}
                          onChange={(e) =>
                            setUReplaceExisting(e.target.checked)
                          }
                        />
                        <span>
                          Replace existing active Class Admin if Class{' '}
                          {uAssignedClass} already has an active administrator
                        </span>
                      </label>

                      <button
                        type="submit"
                        disabled={actionBusy}
                        className="px-5 py-2.5 rounded-lg bg-[#D4AF37] text-neutral-950 font-semibold text-xs cursor-pointer"
                      >
                        Add User Account
                      </button>
                    </div>
                  </form>

                  {/* Edit User Modal / Form when editingUser is selected */}
                  {editingUser && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleUpdateAdminUser(editingUser.id, {
                          name: editUserName.trim(),
                          email: editUserEmail.trim(),
                          newPassword: editUserPassword.trim(),
                          role: editUserRole,
                          assignedClass:
                            editUserRole === 'CLASS_ADMIN'
                              ? editUserClass
                              : null,
                          replaceExistingClassAdmin: true,
                        });
                      }}
                      className="p-6 rounded-xl bg-[#131826] border-2 border-[#D4AF37] space-y-4 shadow-2xl"
                    >
                      <div className="flex items-center justify-between">
                        <h3 className="font-display text-base font-bold text-[#F3D068]">
                          Edit User Gmail, Password & Role — {editingUser.email}
                        </h3>
                        <button
                          type="button"
                          onClick={() => setEditingUser(null)}
                          className="text-xs text-neutral-400 hover:text-white cursor-pointer"
                        >
                          Cancel Edit
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-neutral-300 mb-1">
                            Full Name *
                          </label>
                          <input
                            type="text"
                            required
                            value={editUserName}
                            onChange={(e) => setEditUserName(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg bg-[#0B0D14] border border-neutral-700 text-sm text-white"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-neutral-300 mb-1">
                            Gmail Address *
                          </label>
                          <input
                            type="email"
                            required
                            value={editUserEmail}
                            onChange={(e) => setEditUserEmail(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg bg-[#0B0D14] border border-neutral-700 text-sm text-white"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-neutral-300 mb-1">
                            Password *
                          </label>
                          <input
                            type="text"
                            required
                            value={editUserPassword}
                            onChange={(e) => setEditUserPassword(e.target.value)}
                            placeholder="Enter new or current password"
                            className="w-full px-3 py-2 rounded-lg bg-[#0B0D14] border border-neutral-700 text-sm text-[#F3D068] font-mono"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-neutral-300 mb-1">
                            Role *
                          </label>
                          <select
                            value={editUserRole}
                            onChange={(e) =>
                              setEditUserRole(
                                e.target.value as
                                  | 'SUPER_ADMIN'
                                  | 'TEACHER'
                                  | 'CLASS_ADMIN'
                              )
                            }
                            className="w-full px-3 py-2 rounded-lg bg-[#0B0D14] border border-neutral-700 text-sm text-white"
                          >
                            <option value="CLASS_ADMIN">Class Admin</option>
                            <option value="TEACHER">Teacher (Full Control except Users)</option>
                            <option value="SUPER_ADMIN">Super Admin</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-neutral-300 mb-1">
                            Assigned Class
                          </label>
                          <select
                            value={editUserClass}
                            disabled={
                              editUserRole === 'SUPER_ADMIN' ||
                              editUserRole === 'TEACHER'
                            }
                            onChange={(e) =>
                              setEditUserClass(e.target.value as ClassCode)
                            }
                            className="w-full px-3 py-2 rounded-lg bg-[#0B0D14] border border-neutral-700 text-sm text-white disabled:opacity-50"
                          >
                            {VALID_CLASSES.map((c) => (
                              <option key={c} value={c}>
                                Class {c}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="flex justify-end gap-3 pt-2">
                        <button
                          type="button"
                          onClick={() => setEditingUser(null)}
                          className="px-4 py-2 rounded-lg bg-neutral-900 text-xs text-neutral-300 border border-neutral-700 cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={actionBusy}
                          className="px-5 py-2 rounded-lg bg-[#D4AF37] text-neutral-950 font-semibold text-xs cursor-pointer"
                        >
                          {actionBusy ? 'Saving...' : 'Save Gmail, Password & Role'}
                        </button>
                      </div>
                    </form>
                  )}

                  {/* Users Table with Gmail, Password, Role Switcher, Class Switcher, Edit & Delete */}
                  <div className="rounded-xl bg-[#0E1118] border border-neutral-800 overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-neutral-800 text-xs text-neutral-400 uppercase">
                          <th className="py-3.5 px-5">Name</th>
                          <th className="py-3.5 px-5">Gmail</th>
                          <th className="py-3.5 px-5">Password</th>
                          <th className="py-3.5 px-5">Role</th>
                          <th className="py-3.5 px-5">Assigned Class</th>
                          <th className="py-3.5 px-5">Status</th>
                          <th className="py-3.5 px-5 text-right">
                            Edit / Delete
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-800 text-sm">
                        {usersList.map((u) => (
                          <tr key={u.id} className="hover:bg-[#141824]">
                            <td className="py-3.5 px-5 font-semibold text-white">
                              {u.name}
                            </td>
                            <td className="py-3.5 px-5 font-mono text-xs text-emerald-300">
                              {u.email}
                            </td>
                            <td className="py-3.5 px-5">
                              <span className="inline-flex items-center px-2.5 py-1 rounded bg-[#161A26] border border-[#D4AF37]/40 font-mono text-xs text-[#F3D068] select-all">
                                {u.passwordPlain || 'IlmAdmin#2026'}
                              </span>
                            </td>
                            <td className="py-3.5 px-5">
                              <select
                                value={u.role}
                                onChange={(e) => {
                                  const nextRole = e.target.value as
                                    | 'SUPER_ADMIN'
                                    | 'TEACHER'
                                    | 'CLASS_ADMIN';
                                  handleUpdateAdminUser(u.id, {
                                    role: nextRole,
                                    assignedClass:
                                      nextRole === 'CLASS_ADMIN'
                                        ? u.assignedClass || 'U1'
                                        : null,
                                    replaceExistingClassAdmin: true,
                                  });
                                }}
                                className="px-2.5 py-1 rounded bg-neutral-900 border border-neutral-700 text-xs font-semibold text-[#F3D068]"
                              >
                                <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                                <option value="TEACHER">TEACHER</option>
                                <option value="CLASS_ADMIN">CLASS_ADMIN</option>
                              </select>
                            </td>
                            <td className="py-3.5 px-5 font-mono-tabular text-xs text-white">
                              {u.role === 'SUPER_ADMIN' || u.role === 'TEACHER' ? (
                                <span className="text-neutral-400">
                                  Global (All U1–U6)
                                </span>
                              ) : (
                                <select
                                  value={u.assignedClass || 'U1'}
                                  onChange={(e) =>
                                    handleUpdateAdminUser(u.id, {
                                      assignedClass: e.target
                                        .value as ClassCode,
                                      replaceExistingClassAdmin: true,
                                    })
                                  }
                                  className="px-2.5 py-1 rounded bg-neutral-900 border border-neutral-700 text-xs text-white"
                                >
                                  {VALID_CLASSES.map((c) => (
                                    <option key={c} value={c}>
                                      Class {c}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </td>
                            <td className="py-3.5 px-5 text-xs">
                              <button
                                type="button"
                                onClick={() =>
                                  handleUpdateAdminUser(u.id, {
                                    status:
                                      u.status === 'ACTIVE'
                                        ? 'DEACTIVATED'
                                        : 'ACTIVE',
                                    replaceExistingClassAdmin: true,
                                  })
                                }
                                className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer border ${
                                  u.status === 'ACTIVE'
                                    ? 'bg-emerald-950/50 text-emerald-300 border-emerald-700/50'
                                    : 'bg-neutral-900 text-neutral-400 border-neutral-700'
                                }`}
                              >
                                {u.status}
                              </button>
                            </td>
                            <td className="py-3.5 px-5 text-right">
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingUser(u);
                                    setEditUserName(u.name);
                                    setEditUserEmail(u.email);
                                    setEditUserPassword(
                                      u.passwordPlain || 'IlmAdmin#2026'
                                    );
                                    setEditUserRole(u.role);
                                    setEditUserClass(u.assignedClass || 'U1');
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#161A26] hover:bg-[#1E2436] text-xs text-[#F3D068] border border-[#D4AF37]/40 cursor-pointer"
                                >
                                  <Edit3 className="w-3 h-3" />
                                  <span>Edit</span>
                                </button>
                                {u.id !== currentUser.id && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setConfirmDelete({
                                        type: 'user',
                                        id: u.id,
                                        label: `${u.name} (${u.email})`,
                                      })
                                    }
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-red-950/40 hover:bg-red-950/80 text-xs text-red-300 border border-red-900/50 cursor-pointer"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                    <span>Delete</span>
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ===============================================================
                  SECTION 11: ACTIVITY LOGS (SUPER ADMIN & TEACHER)
                 =============================================================== */}
              {activeSection === 'logs' && hasGlobalControl && (
                <div className="space-y-6">
                  <div>
                    <h1 className="font-display text-2xl font-bold text-white">
                      Administrative Audit & Activity Logs
                    </h1>
                    <p className="text-sm text-neutral-400 mt-1">
                      Immutable audit log recording authentication events, participant additions, automatic poster generations, feed moderations, and result publications.
                    </p>
                  </div>

                  <div className="rounded-xl bg-[#0E1118] border border-neutral-800 overflow-hidden">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-neutral-800 text-xs text-neutral-400 uppercase">
                          <th className="py-3.5 px-5">Timestamp</th>
                          <th className="py-3.5 px-5">Actor</th>
                          <th className="py-3.5 px-5">Action</th>
                          <th className="py-3.5 px-5">Class</th>
                          <th className="py-3.5 px-5">Details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-800 text-xs">
                        {logsList.map((log) => (
                          <tr key={log.id} className="hover:bg-[#141824]">
                            <td className="py-3 px-5 font-mono-tabular text-neutral-400 whitespace-nowrap">
                              {new Date(log.createdAt).toLocaleString()}
                            </td>
                            <td className="py-3 px-5 text-white">
                              {log.actorEmail}{' '}
                              <span className="text-neutral-500">
                                ({log.actorRole})
                              </span>
                            </td>
                            <td className="py-3 px-5 font-semibold text-[#F3D068]">
                              {log.action}
                            </td>
                            <td className="py-3 px-5 font-mono-tabular text-neutral-300">
                              {log.classCode || 'Global'}
                            </td>
                            <td className="py-3 px-5 text-neutral-300">
                              {log.details}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ===============================================================
                  SECTION 12: PLATFORM SETTINGS (SUPER ADMIN & TEACHER)
                 =============================================================== */}
              {activeSection === 'settings' && hasGlobalControl && (
                <form
                  onSubmit={handleSavePlatformSettings}
                  className="max-w-3xl space-y-6"
                >
                  <div>
                    <h1 className="font-display text-2xl font-bold text-white">
                      Global Platform & Branding Settings
                    </h1>
                    <p className="text-sm text-neutral-400 mt-1">
                      Configure platform-wide titles, motto, current academic week, and cohort descriptions.
                    </p>
                  </div>

                  <div className="p-6 rounded-xl bg-[#0E1118] border border-neutral-800 space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-neutral-300 mb-1">
                        Platform Title
                      </label>
                      <input
                        type="text"
                        value={settingsMap.platformName || ''}
                        onChange={(e) =>
                          setSettingsMap((prev) => ({
                            ...prev,
                            platformName: e.target.value,
                          }))
                        }
                        className="w-full px-3.5 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-neutral-300 mb-1">
                        Institutional Motto
                      </label>
                      <input
                        type="text"
                        value={settingsMap.motto || ''}
                        onChange={(e) =>
                          setSettingsMap((prev) => ({
                            ...prev,
                            motto: e.target.value,
                          }))
                        }
                        className="w-full px-3.5 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-neutral-300 mb-1">
                        Current Academic Week Label
                      </label>
                      <input
                        type="text"
                        value={settingsMap.currentAcademicWeek || ''}
                        onChange={(e) =>
                          setSettingsMap((prev) => ({
                            ...prev,
                            currentAcademicWeek: e.target.value,
                          }))
                        }
                        className="w-full px-3.5 py-2 rounded-lg bg-[#12151F] border border-neutral-700 text-sm text-white"
                      />
                    </div>

                    <div className="pt-4 border-t border-neutral-800 space-y-4">
                      <div className="p-4 rounded-xl bg-[#0D101A] border border-neutral-800 space-y-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <h4 className="text-sm font-semibold text-[#F3D068] flex items-center gap-2">
                              <span>✨</span> AI Assistant Control
                            </h4>
                            <p className="text-xs text-neutral-400 mt-0.5">
                              Turn the assistant ON/OFF and keep chat conversations ephemeral without saving history.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setSettingsMap((prev) => ({
                                ...prev,
                                aiAssistantEnabled: aiAssistantEnabled ? 'false' : 'true',
                              }))
                            }
                            className={`px-3 py-1.5 rounded-full text-[10px] font-semibold border cursor-pointer ${
                              aiAssistantEnabled
                                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700/50'
                                : 'bg-neutral-900 text-neutral-300 border-neutral-700'
                            }`}
                          >
                            {aiAssistantEnabled ? 'ON' : 'OFF'}
                          </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                          <div>
                            <label className="block text-xs font-medium text-neutral-300 mb-1">
                              Gemini API Key
                            </label>
                            <input
                              type="password"
                              placeholder="AIza..."
                              value={settingsMap.geminiApiKey || ''}
                              onChange={(e) =>
                                setSettingsMap((prev) => ({
                                  ...prev,
                                  geminiApiKey: e.target.value,
                                }))
                              }
                              className="w-full px-3.5 py-2 rounded-lg bg-[#141824] border border-neutral-700 text-sm text-white font-mono placeholder:text-neutral-500 focus:border-[#D4AF37] focus:outline-none"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-neutral-300 mb-1">
                              Chat API Key
                            </label>
                            <input
                              type="password"
                              placeholder="Optional chat token"
                              value={settingsMap.chatApiKey || ''}
                              onChange={(e) =>
                                setSettingsMap((prev) => ({
                                  ...prev,
                                  chatApiKey: e.target.value,
                                }))
                              }
                              className="w-full px-3.5 py-2 rounded-lg bg-[#141824] border border-neutral-700 text-sm text-white font-mono placeholder:text-neutral-500 focus:border-[#D4AF37] focus:outline-none"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="text-sm font-semibold text-[#F3D068] flex items-center gap-2">
                              <span>☁️</span> Cloud Database & Image Storage Configuration
                            </h4>
                            <p className="text-xs text-neutral-400 mt-0.5">
                              Manage Supabase, ImgBB permanent image hosting, and Cloud SQL PostgreSQL.
                            </p>
                          </div>
                          <span className="px-2.5 py-1 rounded-full text-[10px] font-semibold bg-emerald-950/80 border border-emerald-600/50 text-emerald-300">
                            PostgreSQL Active (asia-southeast1)
                          </span>
                        </div>

                        <div className="p-4 rounded-xl bg-[#0D101A] border border-neutral-800 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                              <span className="text-xs font-bold text-white uppercase tracking-wider">
                                https://imgbb.com/ Image CDN Integration
                              </span>
                            </div>
                            <a
                              href="https://api.imgbb.com/"
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] text-[#F3D068] hover:underline"
                            >
                              Get Free API Key →
                            </a>
                          </div>
                          <p className="text-xs text-neutral-400">
                            Participant portraits, candidate photos aur custom poster backgrounds direct ImgBB CDN par permanently host honge.
                          </p>
                          <div>
                            <label className="block text-xs font-medium text-neutral-300 mb-1">
                              ImgBB API Key
                            </label>
                            <div className="flex gap-2">
                              <input
                                type="password"
                                placeholder="e.g. 7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c"
                                value={settingsMap.imgbbApiKey || ''}
                                onChange={(e) =>
                                  setSettingsMap((prev) => ({
                                    ...prev,
                                    imgbbApiKey: e.target.value,
                                  }))
                                }
                                className="flex-1 px-3.5 py-2 rounded-lg bg-[#141824] border border-neutral-700 text-sm text-white font-mono placeholder:text-neutral-500 focus:border-[#D4AF37] focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={handleTestImgBB}
                                disabled={imgbbTestStatus?.loading || !settingsMap.imgbbApiKey}
                                className="px-3.5 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-600 text-xs font-semibold cursor-pointer disabled:opacity-50"
                              >
                                {imgbbTestStatus?.loading ? 'Testing...' : 'Test ImgBB'}
                              </button>
                            </div>
                            {imgbbTestStatus && (
                              <div
                                className={`mt-2 p-2.5 rounded-lg text-xs flex items-center justify-between ${
                                  imgbbTestStatus.success
                                    ? 'bg-emerald-950/60 border border-emerald-700/60 text-emerald-300'
                                    : 'bg-red-950/60 border border-red-700/60 text-red-300'
                                }`}
                              >
                                <span>{imgbbTestStatus.message}</span>
                                {imgbbTestStatus.imageUrl && (
                                  <a
                                    href={imgbbTestStatus.imageUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline font-mono text-[10px] ml-2 shrink-0"
                                  >
                                    View Test Upload
                                  </a>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="p-4 rounded-xl bg-[#0D101A] border border-neutral-800 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
                              <span className="text-xs font-bold text-white uppercase tracking-wider">
                                Supabase Database Integration
                              </span>
                            </div>
                            <span className="text-[11px] text-neutral-400">
                              PostgreSQL Relational Storage
                            </span>
                          </div>
                          <p className="text-xs text-neutral-400">
                            Apna Supabase Project URL aur Public / Anon Key yahan enter karein data sync aur storage ke liye.
                          </p>
                          <div className="space-y-2.5">
                            <div>
                              <label className="block text-xs font-medium text-neutral-300 mb-1">
                                Supabase Project URL
                              </label>
                              <input
                                type="text"
                                placeholder="https://xyzcompany.supabase.co"
                                value={settingsMap.supabaseUrl || ''}
                                onChange={(e) =>
                                  setSettingsMap((prev) => ({
                                    ...prev,
                                    supabaseUrl: e.target.value,
                                  }))
                                }
                                className="w-full px-3.5 py-2 rounded-lg bg-[#141824] border border-neutral-700 text-sm text-white font-mono placeholder:text-neutral-500 focus:border-[#D4AF37] focus:outline-none"
                              />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                              <div>
                                <label className="block text-xs font-medium text-neutral-300 mb-1">
                                  Supabase Anon / Public Key
                                </label>
                                <input
                                  type="password"
                                  placeholder="eyJhbGciOiJIUzI1NiIsIn..."
                                  value={settingsMap.supabaseAnonKey || ''}
                                  onChange={(e) =>
                                    setSettingsMap((prev) => ({
                                      ...prev,
                                      supabaseAnonKey: e.target.value,
                                    }))
                                  }
                                  className="w-full px-3.5 py-2 rounded-lg bg-[#141824] border border-neutral-700 text-sm text-white font-mono placeholder:text-neutral-500 focus:border-[#D4AF37] focus:outline-none"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-neutral-300 mb-1">
                                  Supabase Service Role Key (Optional)
                                </label>
                                <input
                                  type="password"
                                  placeholder="eyJhbGciOiJIUzI1NiIsIn..."
                                  value={settingsMap.supabaseServiceKey || ''}
                                  onChange={(e) =>
                                    setSettingsMap((prev) => ({
                                      ...prev,
                                      supabaseServiceKey: e.target.value,
                                    }))
                                  }
                                  className="w-full px-3.5 py-2 rounded-lg bg-[#141824] border border-neutral-700 text-sm text-white font-mono placeholder:text-neutral-500 focus:border-[#D4AF37] focus:outline-none"
                                />
                              </div>
                            </div>

                            <div className="pt-2 flex flex-wrap items-center gap-2.5">
                              <button
                                type="button"
                                onClick={handleTestSupabase}
                                disabled={supabaseTestStatus?.loading || !settingsMap.supabaseUrl}
                                className="px-3.5 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-600 text-xs font-semibold cursor-pointer disabled:opacity-50"
                              >
                                {supabaseTestStatus?.loading ? 'Connecting...' : '1. Test Connection'}
                              </button>

                              <button
                                type="button"
                                onClick={handleCopySupabaseSql}
                                className="px-3.5 py-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-semibold cursor-pointer transition-colors"
                              >
                                {copiedSql ? '✓ SQL Copied to Clipboard!' : '2. Copy Supabase SQL (Tables DDL)'}
                              </button>

                              <button
                                type="button"
                                onClick={handleSyncToSupabase}
                                disabled={supabaseSyncStatus?.loading}
                                className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-50 shadow-sm transition-colors"
                              >
                                {supabaseSyncStatus?.loading ? 'Syncing Records...' : '3. Sync Live Data to Supabase'}
                              </button>
                            </div>

                            {supabaseTestStatus && (
                              <div
                                className={`p-2.5 rounded-lg text-xs ${
                                  supabaseTestStatus.success
                                    ? 'bg-emerald-950/60 border border-emerald-700/60 text-emerald-300'
                                    : 'bg-red-950/60 border border-red-700/60 text-red-300'
                                }`}
                              >
                                {supabaseTestStatus.message}
                              </div>
                            )}

                            {supabaseSyncStatus && (
                              <div
                                className={`p-2.5 rounded-lg text-xs ${
                                  supabaseSyncStatus.success
                                    ? 'bg-emerald-950/60 border border-emerald-700/60 text-emerald-300'
                                    : 'bg-red-950/60 border border-red-700/60 text-red-300'
                                }`}
                              >
                                {supabaseSyncStatus.message}
                              </div>
                            )}

                            <div className="p-3 rounded-lg bg-[#0d1117] border border-neutral-800 text-[11px] text-neutral-400 space-y-1">
                              <p className="font-semibold text-neutral-300">Supabase me tables dekhne ke 3 simple steps:</p>
                              <p>1. Supabase Dashboard &rarr; <b>Project Settings &rarr; API</b> se URL aur <code className="text-amber-400">anon public key</code> yahan enter karein.</p>
                              <p>2. Upar <b>"Copy Supabase SQL"</b> click karein, fir Supabase ke <b>SQL Editor</b> me ja kar Paste karein aur <b>RUN</b> dabayein.</p>
                              <p>3. Phir <b>"Sync Live Data to Supabase"</b> click karein. Saara data Supabase ke Table Editor me live dikhne lagega!</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pt-2">
                      <button
                        type="submit"
                        disabled={actionBusy}
                        className="px-5 py-2.5 rounded-lg bg-[#D4AF37] text-neutral-950 font-semibold text-xs cursor-pointer"
                      >
                        Save Platform Settings & Database Config
                      </button>
                    </div>
                  </div>
                </form>
              )}
            </>
          )}
        </main>
        </div>
      </div>

      {/* =====================================================================
          ADD PARTICIPANT MODAL (MATCHING SCREENSHOT 2026-10-12 130522.png)
         ===================================================================== */}
      {showAddParticipantModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl bg-white text-slate-900 shadow-2xl overflow-hidden my-8">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">
                Add Participant
              </h3>
              <button
                type="button"
                onClick={() => setShowAddParticipantModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                await handleSaveParticipant(e);
                setShowAddParticipantModal(false);
              }}
              className="p-6 space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Select Student (Quick Fill)
                </label>
                <select
                  value=""
                  onChange={(e) => {
                    const stId = Number(e.target.value);
                    const found = studentsList.find((s) => s.id === stId);
                    if (found) {
                      setPName(found.fullName);
                      setPAdmissionNo(found.admissionNo);
                      setPClass(found.classCode);
                      setPPhotoUrl(found.photoUrl);
                    }
                  }}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-white border border-slate-300 text-sm text-slate-800 focus:border-indigo-600 focus:outline-none"
                >
                  <option value="">-- Or enter manually below --</option>
                  {studentsList
                    .filter((s) => s.classCode === formTargetClass)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.fullName} ({s.admissionNo} · Class {s.classCode})
                      </option>
                    ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Student Name
                  </label>
                  <input
                    type="text"
                    required
                    value={pName}
                    onChange={(e) => setPName(e.target.value)}
                    placeholder="Enter full name"
                    className="w-full px-3.5 py-2.5 rounded-lg bg-white border border-slate-300 text-sm text-slate-900 focus:border-indigo-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Admission No
                  </label>
                  <input
                    type="text"
                    required
                    value={pAdmissionNo}
                    onChange={(e) => setPAdmissionNo(e.target.value)}
                    placeholder="e.g. 1234"
                    className="w-full px-3.5 py-2.5 rounded-lg bg-white border border-slate-300 text-sm text-slate-900 focus:border-indigo-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Class
                  </label>
                  <select
                    value={hasGlobalControl ? pClass : lockedClass!}
                    disabled={!hasGlobalControl}
                    onChange={(e) => setPClass(e.target.value as ClassCode)}
                    className="w-full px-3.5 py-2.5 rounded-lg bg-white border border-slate-300 text-sm text-slate-900 focus:border-indigo-600 focus:outline-none disabled:bg-slate-100"
                  >
                    {VALID_CLASSES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Category
                  </label>
                  <select
                    value={pCategory}
                    onChange={(e) =>
                      setPCategory(e.target.value as CompetitionCategoryName)
                    }
                    className="w-full px-3.5 py-2.5 rounded-lg bg-white border border-slate-300 text-sm text-slate-900 focus:border-indigo-600 focus:outline-none"
                  >
                    {COMPETITION_CATEGORIES.map((cat) => {
                      const count = participantsList.filter(
                        (p) =>
                          p.classCode === formTargetClass &&
                          p.categoryName === cat
                      ).length;
                      const max = CATEGORY_MAX[cat];
                      return (
                        <option key={cat} value={cat}>
                          {cat} ({count}/{max})
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Own Topic (For Speech, Naat, Qirat, etc.)
                </label>
                <input
                  type="text"
                  value={pOwnTopic}
                  onChange={(e) => setPOwnTopic(e.target.value)}
                  placeholder="Enter participant's specific topic"
                  className="w-full px-3.5 py-2.5 rounded-lg bg-white border border-slate-300 text-sm text-slate-900 focus:border-indigo-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Photo
                </label>
                <label className="flex flex-col items-center justify-center p-5 border-2 border-dashed border-slate-300 rounded-xl hover:border-indigo-500 cursor-pointer bg-slate-50/60 transition-colors">
                  {pPhotoUrl ? (
                    <div className="flex items-center gap-3">
                      <img
                        src={pPhotoUrl}
                        alt="Preview"
                        referrerPolicy="no-referrer"
                        className="w-14 h-14 rounded-xl object-cover border border-indigo-500"
                      />
                      <div className="text-left">
                        <div className="text-xs font-semibold text-indigo-600">
                          Click to upload another photo
                        </div>
                        <div className="text-[11px] text-slate-500">
                          PNG, JPG up to 5MB
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <ImageIcon className="w-8 h-8 text-slate-400 mb-1" />
                      <span className="text-xs font-semibold text-indigo-600">
                        Upload a file{' '}
                        <span className="text-slate-500 font-normal">
                          or drag and drop
                        </span>
                      </span>
                      <span className="text-[11px] text-slate-400 mt-0.5">
                        PNG, JPG, GIF up to 5MB
                      </span>
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        handleFileUpload(file, (uploaded) =>
                          setPPhotoUrl(uploaded.fileUrl)
                        );
                      }
                    }}
                  />
                </label>
              </div>

              <button
                type="submit"
                disabled={actionBusy || isFormCategoryAtCapacity}
                className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm cursor-pointer disabled:opacity-50 shadow-md"
              >
                {actionBusy ? 'Saving & Generating Poster...' : 'Add Participant'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          PHOTOSHOP STUDIO MODAL FOR CUSTOM POSTER EDITING
         ===================================================================== */}
      {studioPoster && (
        <PosterPhotoshopStudio
          poster={studioPoster}
          onClose={() => setStudioPoster(null)}
          onSavePoster={handleSavePosterFromStudio}
          onPostToFeed={(poster, dataUrl, caption) =>
            handlePostPosterToFeed(poster, dataUrl, caption)
          }
        />
      )}

      {/* =====================================================================
          DESTRUCTIVE ACTION CONFIRMATION DIALOG
         ===================================================================== */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-[#0E1118] border border-red-700/60 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2 text-red-400 font-semibold text-sm">
              <AlertTriangle className="w-5 h-5" />
              <span>Confirm Removal</span>
            </div>
            <p className="text-xs sm:text-sm text-neutral-300 leading-relaxed">
              Are you sure you want to permanently remove{' '}
              <strong className="text-white">{confirmDelete.label}</strong>?
              {confirmDelete.type === 'participant' &&
                ' The corresponding class and category poster will be automatically regenerated without this participant.'}
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 rounded-lg bg-neutral-900 text-xs text-neutral-300 border border-neutral-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={handleConfirmDeleteAction}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-xs text-white font-semibold cursor-pointer"
              >
                {actionBusy ? 'Removing...' : 'Confirm Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
