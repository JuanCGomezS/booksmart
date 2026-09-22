"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancellationNoteMax = void 0;
exports.parseCancellationNote = parseCancellationNote;
const https_1 = require("firebase-functions/v2/https");
exports.cancellationNoteMax = 500;
function parseCancellationNote(value) {
    if (typeof value !== 'string')
        throw new https_1.HttpsError('invalid-argument', 'A cancellation note is required.');
    const note = value.trim();
    if (!note || note.length > exports.cancellationNoteMax)
        throw new https_1.HttpsError('invalid-argument', 'A cancellation note is required.');
    return note;
}
