"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.claimStoreadminCapacityAppointment = exports.createPublicBooking = exports.getPublicBusinessBySlug = void 0;
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const node_crypto_1 = require("node:crypto");
(0, app_1.initializeApp)();
const db = (0, firestore_1.getFirestore)();
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const idempotencyKeyPattern = /^[A-Za-z0-9_-]{16,128}$/;
const bookingTimeZone = 'America/Bogota';
const blockingAppointmentStatuses = new Set(['pending', 'confirmed']);
const publicPresetThemeIds = new Set(['gold-night', 'royal-night', 'crimson-sun', 'violet-blush', 'teal-night', 'sunset-cream', 'orchid-rose']);
const hexColorPattern = /^#[0-9a-f]{6}$/i;
function minutes(value) {
    if (typeof value !== 'string' || !timePattern.test(value))
        return null;
    const [hour, minute] = value.split(':').map(Number);
    return hour * 60 + minute;
}
function validDate(value) {
    if (typeof value !== 'string' || !datePattern.test(value))
        return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
function businessLocalToday(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: bookingTimeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const value = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${value.year}-${value.month}-${value.day}`;
}
function businessLocalDateTime(date, time) {
    const clock = minutes(time);
    if (!validDate(date) || clock === null)
        return null;
    const [year, month, day] = date.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day, 5 + Math.floor(clock / 60), clock % 60));
}
function positiveInteger(value, fallback, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
    return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}
/** Uses the persisted admin contract; malformed legacy buffers block no extra time. */
function serviceBufferMinutes(value) {
    return positiveInteger(value, 0, 0, 240);
}
/** Keeps the DTO and booking callable on the same safe legacy field contract. */
function bookingCustomerFields(value) {
    const configured = value && typeof value === 'object' ? value : {};
    const field = (name) => configured[name] === 'required' || configured[name] === 'optional' ? configured[name] : 'disabled';
    return { email: field('email'), address: field('address') };
}
/** Keeps legacy businesses bookable with the same defaults as the public client. */
function effectiveBookingSettings(value) {
    const configured = value && typeof value === 'object' ? value : {};
    return {
        minimumNoticeMinutes: positiveInteger(configured.minimumNoticeMinutes, 60),
        bookingHorizonDays: positiveInteger(configured.bookingHorizonDays, 30, 1),
        slotIntervalMinutes: positiveInteger(configured.slotIntervalMinutes, 30, 5, 120),
        closureRules: Array.isArray(configured.closureRules) ? configured.closureRules : [],
        exceptionalClosures: Array.isArray(configured.exceptionalClosures) ? configured.exceptionalClosures : [],
        customerFields: bookingCustomerFields(configured.customerFields),
        productSelectionEnabled: configured.productSelectionEnabled === true,
    };
}
/** Mirrors the root-business operational predicate enforced by Firestore Rules. */
function isBusinessOperational(business, now = new Date()) {
    if (!business || business.active !== true)
        return false;
    if (business.subscriptionStatus === undefined)
        return true;
    if (business.subscriptionStatus !== 'active' && business.subscriptionStatus !== 'trial')
        return false;
    const toDate = (value) => value instanceof Date
        ? value
        : value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function'
            ? value.toDate()
            : undefined;
    const startsAt = toDate(business.subscriptionStartsAt);
    if (business.subscriptionStartsAt !== undefined && (!startsAt || !Number.isFinite(startsAt.getTime()) || startsAt > now))
        return false;
    if (business.planExpiresAt === undefined)
        return true;
    const expiresAt = toDate(business.planExpiresAt);
    return Boolean(expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt >= now);
}
function publicUnavailable() {
    // Do not disclose whether a slug exists, is inactive, or has expired.
    return new https_1.HttpsError('not-found', 'Public business unavailable.');
}
function publicString(value, maximum = 2_048) {
    return typeof value === 'string' && value.trim() && value.trim().length <= maximum ? value.trim() : undefined;
}
function publicThemeDto(value) {
    const theme = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    if (typeof theme.id === 'string' && publicPresetThemeIds.has(theme.id))
        return { id: theme.id };
    const palette = theme.palette && typeof theme.palette === 'object' && !Array.isArray(theme.palette) ? theme.palette : {};
    const keys = ['background', 'surface', 'text', 'primary'];
    if (theme.id === 'custom' && Object.keys(theme).length === 2 && Object.keys(palette).length === 4 && keys.every((key) => typeof palette[key] === 'string' && hexColorPattern.test(palette[key]))) {
        return { id: 'custom', palette: Object.fromEntries(keys.map((key) => [key, palette[key]])) };
    }
    return { id: 'gold-night' };
}
function publicWorkingHours(value) {
    const source = value && typeof value === 'object' ? value : {};
    return Object.fromEntries(Array.from({ length: 7 }, (_, day) => {
        const schedule = source[String(day)];
        if (!schedule || typeof schedule !== 'object')
            return [day, { open: '09:00', close: '18:00', enabled: false }];
        const { open, close, enabled } = schedule;
        return typeof open === 'string' && typeof close === 'string' && timePattern.test(open) && timePattern.test(close) && open < close
            ? [day, { open, close, enabled: enabled === true }]
            : [day, { open: '09:00', close: '18:00', enabled: false }];
    }));
}
/** Normalizes canonical and legacy closures into the one public booking contract. */
function publicClosureRules(booking) {
    const rules = [];
    const ids = new Set();
    for (const rule of booking.closureRules) {
        if (!rule || typeof rule !== 'object')
            continue;
        const value = rule;
        const id = publicString(value.id, 120);
        const startTime = typeof value.startTime === 'string' && timePattern.test(value.startTime) ? value.startTime : undefined;
        const endTime = typeof value.endTime === 'string' && timePattern.test(value.endTime) ? value.endTime : undefined;
        if (!id || ids.has(id) || (startTime === undefined) !== (endTime === undefined) || (startTime && startTime >= endTime))
            continue;
        if (value.kind === 'weekly' && Number.isInteger(value.weekday) && Number(value.weekday) >= 0 && Number(value.weekday) <= 6) {
            rules.push({ id, kind: 'weekly', weekday: Number(value.weekday), ...(startTime ? { startTime, endTime } : {}) });
            ids.add(id);
        }
        else if (value.kind === 'date' && validDate(value.date)) {
            rules.push({ id, kind: 'date', date: value.date, ...(startTime ? { startTime, endTime } : {}) });
            ids.add(id);
        }
    }
    for (const closure of booking.exceptionalClosures) {
        const date = closure && typeof closure === 'object' ? closure.date : undefined;
        const id = typeof date === 'string' ? `legacy-${date}` : '';
        if (!validDate(date) || ids.has(id))
            continue;
        rules.push({ id, kind: 'date', date });
        ids.add(id);
    }
    return rules;
}
function publicStaffSchedule(value) {
    if (!value || typeof value !== 'object')
        return undefined;
    const source = value;
    return Object.fromEntries(Array.from({ length: 7 }, (_, day) => {
        const rawDay = source[String(day)];
        if (rawDay === undefined)
            return [day, undefined];
        if (!rawDay || typeof rawDay !== 'object')
            return [day, { enabled: false, start: '09:00', end: '18:00', breaks: [] }];
        const schedule = rawDay;
        const start = typeof schedule.start === 'string' && timePattern.test(schedule.start) ? schedule.start : undefined;
        const end = typeof schedule.end === 'string' && timePattern.test(schedule.end) ? schedule.end : undefined;
        if (!start || !end || start >= end)
            return [day, { enabled: false, start: '09:00', end: '18:00', breaks: [] }];
        const invalidBreak = !Array.isArray(schedule.breaks) || schedule.breaks.some((item) => {
            if (!item || typeof item !== 'object')
                return true;
            const range = item;
            return typeof range.start !== 'string' || typeof range.end !== 'string' || !timePattern.test(range.start) || !timePattern.test(range.end) || range.start >= range.end;
        });
        return [day, invalidBreak
                ? { enabled: false, start, end, breaks: [] }
                : { enabled: schedule.enabled === true, start, end, breaks: schedule.breaks.map(({ start, end }) => ({ start, end })) }];
    }).filter(([, schedule]) => schedule !== undefined));
}
function publicBusinessDto(id, business, now) {
    const config = business.config && typeof business.config === 'object' ? business.config : {};
    const socialLinks = config.socialLinks && typeof config.socialLinks === 'object' ? config.socialLinks : {};
    const booking = effectiveBookingSettings(config.booking);
    const location = config.location && typeof config.location === 'object' ? config.location : {};
    const latitude = location.latitude;
    const longitude = location.longitude;
    const expiresAt = business.planExpiresAt && typeof business.planExpiresAt === 'object' && 'toDate' in business.planExpiresAt && typeof business.planExpiresAt.toDate === 'function'
        ? business.planExpiresAt.toDate()
        : undefined;
    return {
        id,
        name: publicString(business.name, 120) || '',
        slug: publicString(business.slug, 160) || '',
        businessType: publicString(business.businessType, 80) || 'barbershop',
        active: true,
        ...(expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt >= now ? { bookingEnabledUntil: expiresAt.toISOString() } : {}),
        config: {
            address: publicString(config.address, 240) || '',
            phone: publicString(config.phone, 80) || '',
            ...(publicString(config.logoUrl) ? { logoUrl: publicString(config.logoUrl) } : {}),
            ...(publicString(config.coverUrl) ? { coverUrl: publicString(config.coverUrl) } : {}),
            ...(publicString(config.placeUrl) ? { placeUrl: publicString(config.placeUrl) } : {}),
            ...(typeof latitude === 'number' && typeof longitude === 'number' && Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { location: { latitude, longitude } } : {}),
            ...(Object.keys(socialLinks).length ? { socialLinks: {
                    ...(publicString(socialLinks.instagram) ? { instagram: publicString(socialLinks.instagram) } : {}),
                    ...(publicString(socialLinks.facebook) ? { facebook: publicString(socialLinks.facebook) } : {}),
                    ...(publicString(socialLinks.whatsapp) ? { whatsapp: publicString(socialLinks.whatsapp) } : {}),
                } } : {}),
            theme: publicThemeDto(config.theme),
            booking: {
                minimumNoticeMinutes: booking.minimumNoticeMinutes,
                bookingHorizonDays: booking.bookingHorizonDays,
                slotIntervalMinutes: booking.slotIntervalMinutes,
                closureRules: publicClosureRules(booking),
                exceptionalClosures: [],
                customerFields: booking.customerFields,
                productSelectionEnabled: booking.productSelectionEnabled,
            },
        },
        workingHours: publicWorkingHours(business.workingHours),
    };
}
function publicServiceDto(id, service) {
    const name = publicString(service.name, 120);
    if (!name || service.active !== true || !Number.isInteger(service.duration) || service.duration <= 0)
        return null;
    const staffIds = Array.isArray(service.staffIds)
        ? service.staffIds.flatMap((staffId) => publicString(staffId, 150) ? [publicString(staffId, 150)] : [])
        : undefined;
    return { id, name, active: true, duration: service.duration, bufferMinutes: serviceBufferMinutes(service.bufferMinutes), ...(staffIds ? { staffIds } : {}) };
}
function publicStaffDto(id, staff) {
    const name = publicString(staff.name, 120);
    if (!name || staff.active !== true)
        return null;
    const schedule = publicStaffSchedule(staff.schedule);
    return { id, name, active: true, ...(schedule ? { schedule } : {}) };
}
function publicProductDto(id, product) {
    const name = publicString(product.name, 120);
    if (!name || typeof product.price !== 'number' || !Number.isFinite(product.price) || product.price < 0)
        return null;
    const tags = Array.isArray(product.tags)
        ? product.tags.flatMap((tag) => publicString(tag, 80) ? [publicString(tag, 80)] : []).slice(0, 20)
        : [];
    return {
        id,
        name,
        price: product.price,
        ...(publicString(product.description, 1_000) ? { description: publicString(product.description, 1_000) } : {}),
        ...(publicString(product.imageUrl) ? { imageUrl: publicString(product.imageUrl) } : {}),
        ...(tags.length ? { tags } : {}),
    };
}
exports.getPublicBusinessBySlug = (0, https_1.onCall)(async (request) => {
    const slug = typeof request.data?.slug === 'string' ? request.data.slug.trim() : '';
    if (!slug || slug.length > 160)
        throw new https_1.HttpsError('invalid-argument', 'Invalid public business request.');
    const now = new Date();
    const businesses = await db.collection('barbers').where('slug', '==', slug).limit(2).get();
    if (businesses.size !== 1)
        throw publicUnavailable();
    const businessSnapshot = businesses.docs[0];
    const business = businessSnapshot.data();
    if (!isBusinessOperational(business, now))
        throw publicUnavailable();
    const [productsSnapshot, servicesSnapshot, staffSnapshot] = await Promise.all([
        db.collection(`barbers/${businessSnapshot.id}/products`).where('active', '==', true).get(),
        db.collection(`barbers/${businessSnapshot.id}/services`).where('active', '==', true).get(),
        db.collection(`barbers/${businessSnapshot.id}/barbers`).where('active', '==', true).get(),
    ]);
    return {
        business: publicBusinessDto(businessSnapshot.id, business, now),
        products: productsSnapshot.docs.flatMap((product) => {
            const dto = publicProductDto(product.id, product.data());
            return dto ? [dto] : [];
        }),
        services: servicesSnapshot.docs.flatMap((service) => {
            const dto = publicServiceDto(service.id, service.data());
            return dto ? [dto] : [];
        }),
        staff: staffSnapshot.docs.flatMap((staff) => {
            const dto = publicStaffDto(staff.id, staff.data());
            return dto ? [dto] : [];
        }),
    };
});
/** Normalizes Colombian mobile input without persisting the raw presentation form. */
function normalizeBookingPhone(value) {
    const digits = value.replace(/\D/g, '');
    const mobile = digits.startsWith('57') ? digits.slice(2) : digits;
    return /^3\d{9}$/.test(mobile) ? `57${mobile}` : null;
}
function hash(value) {
    return (0, node_crypto_1.createHash)('sha256').update(value).digest('hex');
}
function requestFingerprint(input, normalizedPhone) {
    return hash(JSON.stringify({
        businessId: input.businessId,
        serviceId: input.serviceId,
        bookingDate: input.bookingDate,
        startTime: input.startTime,
        clientName: input.clientName.trim(),
        clientPhone: normalizedPhone,
        clientEmail: input.clientEmail?.trim() || '',
        clientAddress: input.clientAddress?.trim() || '',
        acceptedBookingPrivacy: input.acceptedBookingPrivacy === true,
        anyProfessional: input.anyProfessional === true,
        staffId: input.staffId || '',
        requestedProducts: input.requestedProducts || [],
        notes: input.notes?.trim() || '',
    }));
}
function slotIds(start, duration, buffer, interval) {
    const startMinutes = minutes(start);
    if (startMinutes === null || typeof duration !== 'number' || !Number.isInteger(duration) || duration <= 0 || typeof buffer !== 'number' || !Number.isInteger(buffer) || buffer < 0 || typeof interval !== 'number' || !Number.isInteger(interval) || interval < 5 || interval > 120 || startMinutes % interval !== 0)
        return null;
    const end = startMinutes + duration + buffer;
    if (end > 24 * 60)
        return null;
    const format = (value) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
    const result = [];
    for (let value = startMinutes; value < end; value += interval)
        result.push({ id: format(value).replace(':', ''), startTime: format(value), endTime: format(Math.min(value + interval, 24 * 60)) });
    return result;
}
function hasClosure(booking, date, start, end) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    return publicClosureRules(booking).some((rule) => {
        if ((rule.kind === 'weekly' && rule.weekday !== weekday) || (rule.kind === 'date' && rule.date !== date))
            return false;
        const from = rule.startTime === undefined ? 0 : minutes(rule.startTime);
        const to = rule.endTime === undefined ? 24 * 60 : minutes(rule.endTime);
        return from !== null && to !== null && start < to && end > from;
    });
}
function validCustomerFields(request, booking) {
    const fields = booking.customerFields;
    const valid = (key, setting, max, check) => {
        const state = fields[setting];
        const value = request[key]?.trim() || '';
        return state === 'disabled' ? !value : value.length <= max && (!check || !value || check(value)) && (state !== 'required' || value.length > 0);
    };
    const extra = fields.email !== 'disabled' || fields.address !== 'disabled';
    return valid('clientEmail', 'email', 254, (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) &&
        valid('clientAddress', 'address', 240) && (!extra || request.acceptedBookingPrivacy === true);
}
async function canonicalProducts(transaction, businessId, enabled, products) {
    if (products === undefined)
        return [];
    if (!enabled || !Array.isArray(products) || products.length > 10)
        throw new https_1.HttpsError('invalid-argument', 'Invalid product request.');
    const requests = products;
    const ids = new Set();
    if (!requests.every((product) => typeof product?.productId === 'string' && product.productId.length > 0 && product.productId.length <= 150 && (product.name === undefined || typeof product.name === 'string') && Number.isInteger(product.quantity) && product.quantity >= 1 && product.quantity <= 10 && !ids.has(product.productId) && Boolean(ids.add(product.productId))))
        throw new https_1.HttpsError('invalid-argument', 'Invalid product request.');
    const snapshots = await Promise.all(requests.map((product) => transaction.get(db.doc(`barbers/${businessId}/products/${product.productId}`))));
    return snapshots.map((snapshot, index) => {
        const data = snapshot.data();
        const name = typeof data?.name === 'string' ? data.name.trim() : '';
        if (!snapshot.exists || data?.active !== true || !name || (requests[index].name !== undefined && requests[index].name.trim() !== name))
            throw new https_1.HttpsError('failed-precondition', 'Requested product is no longer available.');
        return { productId: requests[index].productId, name, quantity: requests[index].quantity };
    });
}
exports.createPublicBooking = (0, https_1.onCall)(async (request) => {
    const input = request.data;
    const normalizedPhone = typeof input?.clientPhone === 'string' ? normalizeBookingPhone(input.clientPhone) : null;
    if (!input || typeof input.businessId !== 'string' || !validDate(input.bookingDate) || minutes(input.startTime) === null || typeof input.clientName !== 'string' || !input.clientName.trim() || input.clientName.trim().length > 120 || !normalizedPhone || typeof input.serviceId !== 'string' || !input.serviceId || typeof input.idempotencyKey !== 'string' || !idempotencyKeyPattern.test(input.idempotencyKey) || (input.notes !== undefined && (typeof input.notes !== 'string' || input.notes.length > 500)))
        throw new https_1.HttpsError('invalid-argument', 'Invalid booking request.');
    const appointmentRef = db.collection(`barbers/${input.businessId}/appointments`).doc();
    const idempotencyRef = db.doc(`barbers/${input.businessId}/bookingIdempotency/${hash(input.idempotencyKey)}`);
    const phoneDayRef = db.doc(`barbers/${input.businessId}/bookingPhoneDays/${hash(`${normalizedPhone}:${input.bookingDate}`)}`);
    const fingerprint = requestFingerprint(input, normalizedPhone);
    const appointmentId = await db.runTransaction(async (transaction) => {
        const businessRef = db.doc(`barbers/${input.businessId}`);
        const serviceRef = db.doc(`barbers/${input.businessId}/services/${input.serviceId}`);
        const [businessSnapshot, serviceSnapshot, idempotencySnapshot, phoneDaySnapshot] = await Promise.all([transaction.get(businessRef), transaction.get(serviceRef), transaction.get(idempotencyRef), transaction.get(phoneDayRef)]);
        if (idempotencySnapshot.exists) {
            const completed = idempotencySnapshot.data();
            if (completed?.fingerprint !== fingerprint || typeof completed.appointmentId !== 'string')
                throw new https_1.HttpsError('already-exists', 'A booking request has already been submitted.');
            return completed.appointmentId;
        }
        const business = businessSnapshot.data();
        const service = serviceSnapshot.data();
        const booking = effectiveBookingSettings(business?.config?.booking);
        if (!businessSnapshot.exists || !isBusinessOperational(business) || !serviceSnapshot.exists || service?.active !== true)
            throw new https_1.HttpsError('failed-precondition', 'Booking is unavailable.');
        if (!validCustomerFields(input, booking) || (booking.productSelectionEnabled !== true && input.requestedProducts !== undefined))
            throw new https_1.HttpsError('invalid-argument', 'Invalid booking request.');
        const bufferMinutes = serviceBufferMinutes(service.bufferMinutes);
        const intervals = slotIds(input.startTime, service.duration, bufferMinutes, booking.slotIntervalMinutes);
        const requestedAt = businessLocalDateTime(input.bookingDate, input.startTime);
        const today = businessLocalToday();
        const dayOffset = (Date.parse(`${input.bookingDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
        if (!intervals || !requestedAt || requestedAt.getTime() < Date.now() + booking.minimumNoticeMinutes * 60_000 || dayOffset < 0 || dayOffset > booking.bookingHorizonDays)
            throw new https_1.HttpsError('failed-precondition', 'Booking is unavailable.');
        const start = minutes(input.startTime);
        const end = start + Number(service.duration) + bufferMinutes;
        if (hasClosure(booking, input.bookingDate, start, end))
            throw new https_1.HttpsError('failed-precondition', 'Booking is unavailable.');
        if (phoneDaySnapshot.exists) {
            const existingAppointmentId = phoneDaySnapshot.data()?.appointmentId;
            const existingAppointment = typeof existingAppointmentId === 'string'
                ? await transaction.get(db.doc(`barbers/${input.businessId}/appointments/${existingAppointmentId}`))
                : null;
            if (existingAppointment?.exists && blockingAppointmentStatuses.has(existingAppointment.data()?.status)) {
                throw new https_1.HttpsError('already-exists', 'A booking already exists for this phone on this date.');
            }
        }
        const products = await canonicalProducts(transaction, input.businessId, booking.productSelectionEnabled === true, input.requestedProducts);
        const staffSnapshot = await transaction.get(db.collection(`barbers/${input.businessId}/barbers`));
        const candidates = staffSnapshot.docs.filter((staff) => {
            const data = staff.data();
            if (data.active !== true || (Array.isArray(service.staffIds) && !service.staffIds.includes(staff.id)))
                return false;
            const weekday = new Date(`${input.bookingDate}T12:00:00Z`).getUTCDay();
            const businessDay = business.workingHours?.[weekday];
            const schedule = data.schedule?.[weekday] || { enabled: businessDay?.enabled === true, start: businessDay?.open, end: businessDay?.close, breaks: [] };
            const scheduleStart = minutes(schedule.start);
            const scheduleEnd = minutes(schedule.end);
            const businessStart = minutes(businessDay?.open);
            const businessEnd = minutes(businessDay?.close);
            const overlapsBreak = Array.isArray(schedule.breaks) && schedule.breaks.some((item) => {
                if (!item || typeof item !== 'object')
                    return true;
                const range = item;
                const breakStart = minutes(range.start);
                const breakEnd = minutes(range.end);
                return breakStart === null || breakEnd === null || start < breakEnd && end > breakStart;
            });
            return businessDay?.enabled === true && schedule.enabled === true && scheduleStart !== null && scheduleEnd !== null && businessStart !== null && businessEnd !== null && start >= businessStart && end <= businessEnd && start >= scheduleStart && end <= scheduleEnd && !overlapsBreak;
        }).filter((staff) => input.anyProfessional === true || staff.id === input.staffId);
        if (!candidates.length)
            throw new https_1.HttpsError('failed-precondition', 'Booking is unavailable.');
        for (const staff of candidates) {
            const lockRefs = intervals.map((interval) => db.doc(`barbers/${input.businessId}/bookingLocks/${input.bookingDate}/staff/${staff.id}/intervals/${interval.id}`));
            const locks = await Promise.all(lockRefs.map((reference) => transaction.get(reference)));
            if (locks.some((lock) => lock.exists))
                continue;
            transaction.set(appointmentRef, {
                clientName: input.clientName.trim(), clientPhone: normalizedPhone, serviceId: input.serviceId, serviceName: service.name, extraServices: [], bookingDate: input.bookingDate,
                ...(input.anyProfessional ? { assignmentState: 'unassigned', capacityStaffId: staff.id } : { barberId: staff.id }),
                ...(input.clientEmail?.trim() ? { clientEmail: input.clientEmail.trim() } : {}), ...(input.clientAddress?.trim() ? { clientAddress: input.clientAddress.trim() } : {}),
                ...(booking.customerFields?.email !== 'disabled' || booking.customerFields?.address !== 'disabled' ? { bookingPrivacyConsent: { version: '2026-08-01', acceptedAt: firestore_1.FieldValue.serverTimestamp() } } : {}),
                ...(products.length ? { requestedProducts: products } : {}), ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
                ...(request.auth ? { customerUid: request.auth.uid } : {}), startTime: input.startTime, endTime: intervals.at(-1).endTime, occupiedIntervalIds: intervals.map((interval) => interval.id), primaryLockId: intervals[0].id, status: 'pending', createdAt: firestore_1.FieldValue.serverTimestamp(),
            });
            lockRefs.forEach((reference, index) => transaction.set(reference, { appointmentId: appointmentRef.id, bookingDate: input.bookingDate, staffId: staff.id, intervalId: intervals[index].id, startTime: intervals[index].startTime, endTime: intervals[index].endTime, createdAt: firestore_1.FieldValue.serverTimestamp() }));
            transaction.set(phoneDayRef, { appointmentId: appointmentRef.id, bookingDate: input.bookingDate, createdAt: firestore_1.FieldValue.serverTimestamp() });
            transaction.set(idempotencyRef, { appointmentId: appointmentRef.id, fingerprint, createdAt: firestore_1.FieldValue.serverTimestamp() });
            return appointmentRef.id;
        }
        throw new https_1.HttpsError('aborted', 'Selected time is no longer available.');
    });
    return { appointmentId };
});
/**
 * Confirms only the capacity offer reserved for a Storeadmin's linked
 * professional profile. The Admin SDK transaction keeps the existing
 * first-valid-claim semantics without broadening browser Firestore writes.
 */
exports.claimStoreadminCapacityAppointment = (0, https_1.onCall)(async (request) => {
    const input = request.data;
    if (!request.auth || typeof input?.businessId !== 'string' || !input.businessId || typeof input.appointmentId !== 'string' || !input.appointmentId) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid appointment claim.');
    }
    const actorId = request.auth.uid;
    const appointmentRef = db.doc(`barbers/${input.businessId}/appointments/${input.appointmentId}`);
    await db.runTransaction(async (transaction) => {
        const actorRef = db.doc(`users/${actorId}`);
        const actorSnapshot = await transaction.get(actorRef);
        const actor = actorSnapshot.data();
        const actorStaffId = typeof actor?.staffId === 'string' ? actor.staffId : '';
        const hasBusiness = Array.isArray(actor?.businessIds) && actor.businessIds.includes(input.businessId);
        if (actor?.role !== 'storeadmin' || actorStaffId !== actorId || actor?.professionalBusinessId !== input.businessId || !hasBusiness) {
            throw new https_1.HttpsError('permission-denied', 'Not authorized to claim this appointment.');
        }
        const [appointmentSnapshot, staffSnapshot] = await Promise.all([
            transaction.get(appointmentRef),
            transaction.get(db.doc(`barbers/${input.businessId}/barbers/${actorStaffId}`)),
        ]);
        const appointment = appointmentSnapshot.data();
        if (!appointmentSnapshot.exists || appointment?.assignmentState !== 'unassigned' || appointment?.capacityStaffId !== actorStaffId || !blockingAppointmentStatuses.has(appointment?.status)) {
            throw new https_1.HttpsError('failed-precondition', 'Appointment is no longer available.');
        }
        if (!staffSnapshot.exists || staffSnapshot.data()?.active !== true) {
            throw new https_1.HttpsError('failed-precondition', 'Professional profile is not available.');
        }
        const [serviceSnapshot, ...capacityLocks] = await Promise.all([
            transaction.get(db.doc(`barbers/${input.businessId}/services/${appointment.serviceId}`)),
            ...(Array.isArray(appointment.occupiedIntervalIds) ? appointment.occupiedIntervalIds : []).map((intervalId) => transaction.get(db.doc(`barbers/${input.businessId}/bookingLocks/${appointment.bookingDate}/staff/${actorStaffId}/intervals/${intervalId}`))),
        ]);
        const service = serviceSnapshot.data();
        if (!serviceSnapshot.exists || service?.active !== true || (Array.isArray(service.staffIds) && !service.staffIds.includes(actorStaffId)) || capacityLocks.length === 0 || capacityLocks.some((lock) => !lock.exists || lock.data()?.appointmentId !== input.appointmentId)) {
            throw new https_1.HttpsError('failed-precondition', 'Appointment is no longer available.');
        }
        transaction.update(appointmentRef, {
            assignmentState: 'assigned',
            barberId: actorStaffId,
            capacityStaffId: firestore_1.FieldValue.delete(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
    });
});
