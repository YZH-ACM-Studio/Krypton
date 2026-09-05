const COURSE_COPY_TITLE_SUFFIX = '（副本）';
const COURSE_TITLE_MAX_LENGTH = 64;

/** Build a create-form title that still satisfies Types.Title (1–64, non-blank). */
export function copiedCourseTitle(title: string): string | null {
    const base = title.trim();
    if (!base) return null;
    if (base.length + COURSE_COPY_TITLE_SUFFIX.length <= COURSE_TITLE_MAX_LENGTH) return `${base}${COURSE_COPY_TITLE_SUFFIX}`;
    const truncated = base.slice(0, COURSE_TITLE_MAX_LENGTH - COURSE_COPY_TITLE_SUFFIX.length).trimEnd();
    if (!truncated) return null;
    return `${truncated}${COURSE_COPY_TITLE_SUFFIX}`;
}
