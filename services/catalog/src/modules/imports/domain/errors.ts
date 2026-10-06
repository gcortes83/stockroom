import { DomainError, NotFoundError } from '@stockroom/platform';

export const importNotFound = (id: string) => new NotFoundError('IMPORT_NOT_FOUND', `Import ${id} was not found`);

export const unsupportedFile = (reason: string) => new DomainError('UNSUPPORTED_FILE', 400, reason);

export const fileRequired = () => new DomainError('VALIDATION', 400, 'A CSV file is required in the "file" field', {
  errors: [{ path: 'file', message: 'A CSV file is required' }],
});

export const csvInvalidHeader = (missing: string[], jobId: string) =>
  new DomainError('CSV_INVALID_HEADER', 422, `The CSV header is missing required columns: ${missing.join(', ')}`, {
    missing,
    jobId,
  });

export const tooManyRows = (maxRows: number) =>
  new DomainError('TOO_MANY_ROWS', 413, `The CSV file has more than ${maxRows} data rows`, { maxRows });
