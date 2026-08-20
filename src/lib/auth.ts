// Funciones de autenticación para BookSmart

import {
  createUserWithEmailAndPassword,
  deleteUser,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebase';
import { DATA } from './data';
import type { User } from './types';

export const LEGAL_CONSENT_VERSION = '2026-07-31';

export type LegalConsent = {
  version: typeof LEGAL_CONSENT_VERSION;
};

export class RegistrationRecoveryError extends Error {
  constructor(
    code:
      'registration/profile-creation-reverted' | 'registration/profile-creation-recovery-failed',
  ) {
    super(
      code === 'registration/profile-creation-reverted'
        ? 'No se pudo crear el perfil y se revirtió la cuenta.'
        : 'No se pudo crear el perfil ni revertir completamente la cuenta.',
    );
    this.name = 'RegistrationRecoveryError';
    this.code = code;
  }

  readonly code:
    'registration/profile-creation-reverted' | 'registration/profile-creation-recovery-failed';
}

/**
 * Login con email y contraseña
 */
export async function signIn(email: string, password: string): Promise<FirebaseUser> {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user;
}

/**
 * Registro público: siempre crea el rol customer. No se requiere para reservar.
 */
export async function signUpClient(
  name: string,
  email: string,
  password: string,
  legalConsent: LegalConsent,
): Promise<FirebaseUser> {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  const user = credential.user;

  try {
    await setDoc(doc(db, 'users', user.uid), {
      uid: user.uid,
      name,
      email: user.email,
      role: DATA.USER_ROLE.CUSTOMER,
      legalConsent: {
        version: legalConsent.version,
        acceptedAt: serverTimestamp(),
      },
      createdAt: serverTimestamp(),
    });
  } catch (profileError) {
    console.error('Error creating customer profile; attempting account recovery:', profileError);

    try {
      await deleteUser(user);
    } catch (deleteError) {
      console.error('Unable to delete account after profile creation failure:', deleteError);

      try {
        await firebaseSignOut(auth);
      } catch (signOutError) {
        console.error('Unable to sign out after failed account recovery:', signOutError);
      }

      throw new RegistrationRecoveryError('registration/profile-creation-recovery-failed');
    }

    throw new RegistrationRecoveryError('registration/profile-creation-reverted');
  }

  return user;
}

/**
 * Logout
 */
export async function signOut(): Promise<void> {
  return firebaseSignOut(auth);
}

/**
 * Verificar estado de autenticación y obtener datos del usuario
 * Retorna null si no hay usuario autenticado
 */
export async function getCurrentUser(): Promise<(FirebaseUser & { userRecord?: User }) | null> {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      unsubscribe();

      if (!firebaseUser) {
        resolve(null);
        return;
      }

      try {
        // Obtener datos adicionales del usuario desde Firestore
        const userRef = doc(db, 'users', firebaseUser.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          const userData = userSnap.data() as User;
          resolve(Object.assign(firebaseUser, { userRecord: userData }));
        } else {
          resolve(firebaseUser);
        }
      } catch (error) {
        console.error('Error fetching user data:', error);
        resolve(firebaseUser);
      }
    });
  });
}

/**
 * Verificar si el usuario actual es super admin
 */
export async function isSuperAdmin(): Promise<boolean> {
  const user = await getCurrentUser();
  return user?.userRecord?.role === DATA.USER_ROLE.SUPERADMIN;
}

/**
 * Obtener el documento del usuario desde Firestore
 */
export async function getUserRecord(uid: string): Promise<User | null> {
  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);
  return userSnap.exists() ? (userSnap.data() as User) : null;
}

/**
 * Listener en tiempo real para autenticación (hook)
 * Usar en componentes React
 */
export function useAuth(callback: (user: FirebaseUser | null) => void) {
  return onAuthStateChanged(auth, callback);
}
