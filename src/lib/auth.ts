// Funciones de autenticación para BarberFlow

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebase';
import type { User } from './types';

/**
 * Login con email y contraseña
 */
export async function signIn(email: string, password: string): Promise<FirebaseUser> {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user;
}

/**
 * Registro público: siempre crea rol client.
 */
export async function signUpClient(name: string, email: string, password: string): Promise<FirebaseUser> {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  const user = credential.user;

  await setDoc(doc(db, 'users', user.uid), {
    uid: user.uid,
    name,
    email: user.email,
    role: 'client',
    createdAt: serverTimestamp(),
  });

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
  return user?.userRecord?.role === 'superadmin';
}

/**
 * Obtener el documento del usuario desde Firestore
 */
export async function getUserRecord(uid: string): Promise<User | null> {
  try {
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    return userSnap.exists() ? (userSnap.data() as User) : null;
  } catch (error) {
    console.error('Error fetching user record:', error);
    return null;
  }
}

/**
 * Listener en tiempo real para autenticación (hook)
 * Usar en componentes React
 */
export function useAuth(callback: (user: FirebaseUser | null) => void) {
  return onAuthStateChanged(auth, callback);
}
