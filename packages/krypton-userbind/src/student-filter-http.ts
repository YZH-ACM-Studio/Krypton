import { BadRequestError } from 'hydrooj';
import type { ParsedStudentFilterQuery, StudentFilterQueryInput } from './student-filter';
import {
    parseStudentFilterQuery,
    StudentFilterValidationError,
} from './student-filter';

/** Convert pure filter validation failures into the HTTP layer's explicit 400. */
export function parseAdminStudentFilters(
    input: StudentFilterQueryInput,
): ParsedStudentFilterQuery {
    try {
        return parseStudentFilterQuery(input);
    } catch (error) {
        if (error instanceof StudentFilterValidationError) {
            throw new BadRequestError(error.field, null, error.message);
        }
        throw error;
    }
}
