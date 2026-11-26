import type { ObjectId } from 'mongodb';

export const SIGNING_FIELD_KINDS = ['studentId', 'realName', 'signedAt', 'signature'] as const;
export type SigningFieldKind = typeof SIGNING_FIELD_KINDS[number];

export interface SigningAsset {
    storagePath: string;
    sha256: string;
    size: number;
}

export interface SigningPage {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    userUnit: number;
}

/** Coordinates are unscaled PDF page units, with a bottom-left origin. */
export interface SigningField {
    kind: SigningFieldKind;
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize: number;
}

export interface SigningDocument {
    source: SigningAsset & { originalName: string; ext: 'pdf' | 'docx' };
    pdf: SigningAsset;
    font: SigningAsset;
    pages: SigningPage[];
    fields: SigningField[];
    fingerprint: string;
    confirmedFingerprint: string | null;
}

export interface SigningIdentity {
    studentRecordId: ObjectId;
    schoolId: ObjectId;
    uid: number;
    studentId: string;
    realName: string;
}

export interface SigningVersion {
    attemptId: string;
    inputHash: string;
    generation: number;
    documentFingerprint: string;
    identity: SigningIdentity;
    signedAt: Date;
}

export interface SigningAttempt extends SigningVersion {
    fileId: string;
    signaturePng: string;
    /** Recorded before writing the blob, so an interrupted write can be verified. */
    outputHash?: string;
}

export interface SigningState {
    generation: number;
    signedGeneration: number | null;
    acceptedFileIds?: string[];
    attempt?: SigningAttempt;
}

export interface SigningStudent {
    _id: ObjectId;
    schoolId: ObjectId;
    groupIds: ObjectId[];
    boundUserId: number | null;
    studentId: string;
    realName: string;
}
