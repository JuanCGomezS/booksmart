import 'dotenv/config';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

type LegacyRole = 'barber_admin' | 'barber' | 'client';
type CanonicalRole = 'superadmin' | 'storeadmin' | 'staff' | 'customer';
type StaffAssignment = { businessId: string; staffId: string };
type Report = {
  scanned: number;
  ready: string[];
  migrated: string[];
  missingBusinessAssignments: Array<{ uid: string; role: string; reason: string }>;
  conflictingStaffBindings: Array<{ uid: string; businessId: string; staffId: string; boundUserId: string }>;
  automaticStaffBindings: Array<{ uid: string; businessId: string; staffId: string; action: 'reused' | 'created' }>;
};

function getServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Falta FIREBASE_SERVICE_ACCOUNT_JSON en .env');
  return JSON.parse(raw);
}

function canonicalRole(role: unknown): CanonicalRole | null {
  switch (role as LegacyRole | CanonicalRole) {
    case 'superadmin': return 'superadmin'; case 'storeadmin': return 'storeadmin'; case 'staff': return 'staff'; case 'customer': return 'customer';
    case 'barber_admin': return 'storeadmin'; case 'barber': return 'staff'; case 'client': return 'customer'; default: return null;
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()))] : [];
}

function assignments(value: unknown, legacyBusinessId?: string, legacyStaffId?: string): StaffAssignment[] {
  const explicit = Array.isArray(value) ? value.filter((item): item is StaffAssignment => typeof item?.businessId === 'string' && item.businessId.trim().length > 0 && typeof item?.staffId === 'string' && item.staffId.trim().length > 0)
    .map((item) => ({ businessId: item.businessId.trim(), staffId: item.staffId.trim() })) : [];
  if (!explicit.length && legacyBusinessId && legacyStaffId) explicit.push({ businessId: legacyBusinessId, staffId: legacyStaffId });
  return explicit.filter((item, index, values) => values.findIndex((value) => value.businessId === item.businessId) === index);
}

function deterministicStaffId(uid: string) { return `user-${uid}`; }
function staffName(data: Record<string, unknown>) {
  if (typeof data.displayName === 'string' && data.displayName.trim()) return data.displayName.trim();
  return typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'Staff member (edit name)';
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (getApps().length === 0) initializeApp({ credential: cert(getServiceAccount()) });
  const db = getFirestore();
  const users = await db.collection('users').get();
  const report: Report = { scanned: users.size, ready: [], migrated: [], missingBusinessAssignments: [], conflictingStaffBindings: [], automaticStaffBindings: [] };
  let batch = db.batch(); let writes = 0;
  const commit = async () => { if (apply && writes) await batch.commit(); batch = db.batch(); writes = 0; };

  for (const user of users.docs) {
    const data = user.data(); const role = canonicalRole(data.role);
    if (!role) { report.missingBusinessAssignments.push({ uid: user.id, role: String(data.role || ''), reason: 'Rol desconocido; no se modificó.' }); continue; }
    const legacyBusinessId = typeof data.barberId === 'string' && data.barberId.trim() ? data.barberId.trim() : undefined;
    const legacyStaffId = typeof data.staffId === 'string' && data.staffId.trim() ? data.staffId.trim() : undefined;
    const existingAssignments = assignments(data.staffAssignments, legacyBusinessId, legacyStaffId);
    const businessIds = role === 'storeadmin' || role === 'staff'
      ? [...new Set([...strings(data.businessIds), ...(legacyBusinessId ? [legacyBusinessId] : []), ...existingAssignments.map((item) => item.businessId)])]
      : [];
    if ((role === 'storeadmin' || role === 'staff') && !businessIds.length) {
      report.missingBusinessAssignments.push({ uid: user.id, role: String(data.role), reason: 'No tiene un negocio asignado; seleccione uno desde Usuarios, roles y asignaciones.' });
      continue;
    }

    const explicitByBusiness = new Map(existingAssignments.map((item) => [item.businessId, item]));
    const nextAssignments: StaffAssignment[] = [];
    const staffWrites: Array<{ assignment: StaffAssignment; create: boolean }> = [];
    let conflict = false;
    for (const businessId of role === 'staff' ? businessIds : []) {
      const explicit = explicitByBusiness.get(businessId);
      const bound = explicit ? null : await db.collection('barbers').doc(businessId).collection('barbers').where('userId', '==', user.id).get();
      const staffId = explicit?.staffId || bound?.docs.map((item) => item.id).sort()[0] || deterministicStaffId(user.id);
      const staffRef = db.collection('barbers').doc(businessId).collection('barbers').doc(staffId);
      const staff = await staffRef.get();
      const boundUserId = staff.data()?.userId;
      if (typeof boundUserId === 'string' && boundUserId && boundUserId !== user.id) {
        report.conflictingStaffBindings.push({ uid: user.id, businessId, staffId, boundUserId }); conflict = true; continue;
      }
      const create = !staff.exists;
      nextAssignments.push({ businessId, staffId });
      staffWrites.push({ assignment: { businessId, staffId }, create });
      if (!explicit) report.automaticStaffBindings.push({ uid: user.id, businessId, staffId, action: create ? 'created' : 'reused' });
    }
    if (conflict) continue;

    report.ready.push(user.id);
    if (apply) {
      batch.set(user.ref, { role, businessIds, staffAssignments: nextAssignments, barberId: businessIds[0] || null, staffId: nextAssignments[0]?.staffId || null, updatedAt: FieldValue.serverTimestamp() }, { merge: true }); writes += 1;
      for (const { assignment, create } of staffWrites) {
        const staffRef = db.collection('barbers').doc(assignment.businessId).collection('barbers').doc(assignment.staffId);
        batch.set(staffRef, create ? { name: staffName(data), role: 'Staff', userId: user.id, active: true, createdAt: FieldValue.serverTimestamp() } : { userId: user.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true }); writes += 1;
      }
      if (writes >= 450) await commit(); report.migrated.push(user.id);
    }
  }
  await commit();
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...report }, null, 2));
  if (report.missingBusinessAssignments.length || report.conflictingStaffBindings.length) process.exitCode = 2;
}

main().catch((error) => { console.error('Error migrando roles y asignaciones:', error); process.exit(1); });
