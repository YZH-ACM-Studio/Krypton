/**
 * Body parsing for urlencoded, JSON and multipart requests.
 *
 * qs turns more than `arrayLimit` repeated form fields into an object. Its default of 20
 * broke any checkbox list with 21+ ticks, e.g. a contest star roster failed with
 * 「字段 uids 验证失败」. Lists here cover contest participants and school rosters, so the
 * limit sits well above them; `formLimit` still bounds the whole body.
 */
export const FORM_ARRAY_LIMIT = 10000;

export const BODY_OPTIONS = {
    multipart: true,
    jsonLimit: '8mb',
    formLimit: '8mb',
    queryString: { arrayLimit: FORM_ARRAY_LIMIT },
} as const;
