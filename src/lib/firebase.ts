import { createRequire } from 'node:module';
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore, doc, setDoc, serverTimestamp } from 'firebase/firestore';

const require = createRequire(import.meta.url);
const firebaseConfig = require('../../firebase-applet-config.json') as {
  projectId: string;
  appId?: string;
  apiKey: string;
  authDomain: string;
  firestoreDatabaseId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  measurementId?: string;
  oAuthClientId?: string;
  recaptchaSiteKey?: string;
};

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

