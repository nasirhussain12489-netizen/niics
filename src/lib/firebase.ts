import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const googleAuthProvider = new GoogleAuthProvider();
export const firestoreDb = getFirestore(
  firebaseApp,
  (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId ||
    '(default)'
);

export async function syncAdminSessionToFirestore(user: {
  uid: string;
  email: string;
  name: string;
  role: string;
  assignedClass: string | null;
}) {
  try {
    if (!auth.currentUser) return;
    await setDoc(
      doc(firestoreDb, 'adminSessions', user.uid),
      {
        uid: user.uid,
        email: user.email,
        name: user.name,
        role: user.role,
        assignedClass: user.assignedClass || null,
        lastActiveAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch {
    // Non-blocking sync when using custom session token
  }
}

