import '@fastify/multipart';
import { Controller, Get, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  type ImportIssue,
  type ImportJob,
  ISSUE_SEVERITIES,
  pageMeta,
  type Paginated,
  pageQuerySchema,
} from '@stockroom/contracts';
import { ZodPipe } from '@stockroom/platform';
import { CATALOG_CONFIG, type CatalogConfig } from '../../../config';
import { uuidParam } from '../../products/interface/products.controller';
import { ImportService } from '../application/import.service';
import { issuesToCsv } from '../domain/csv-rules';
import { fileRequired, importNotFound } from '../domain/errors';
import { ImportRepository } from '../infrastructure/import.repository';

const issuesQuerySchema = pageQuerySchema.extend({
  severity: z.enum(ISSUE_SEVERITIES).optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

@Controller('v1/imports')
export class ImportsController {
  constructor(
    @Inject(ImportService) private readonly importer: ImportService,
    @Inject(ImportRepository) private readonly imports: ImportRepository,
    @Inject(CATALOG_CONFIG) private readonly config: CatalogConfig,
  ) {}

  @Post()
  async upload(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<ImportJob> {
    if (!request.isMultipart()) throw fileRequired();
    const file = await request.file({ limits: { fileSize: this.config.IMPORT_MAX_BYTES, files: 1 } });
    if (!file) throw fileRequired();
    const job = await this.importer.importCsv(file.file, file.filename);
    void reply.status(201).header('location', `/v1/imports/${job.id}`);
    return job;
  }

  @Get()
  async list(@Query(new ZodPipe(pageQuerySchema)) query: z.output<typeof pageQuerySchema>): Promise<Paginated<ImportJob>> {
    const { items, total } = await this.imports.listJobs(query.page, query.pageSize);
    return { data: items, page: pageMeta(query.page, query.pageSize, total) };
  }

  @Get(':id')
  async get(@Param('id', uuidParam) id: string): Promise<ImportJob> {
    const job = await this.imports.getJob(id);
    if (!job) throw importNotFound(id);
    return job;
  }

  @Get(':id/issues')
  async issues(
    @Param('id', uuidParam) id: string,
    @Query(new ZodPipe(issuesQuerySchema)) query: z.output<typeof issuesQuerySchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Paginated<ImportIssue> | string> {
    const job = await this.imports.getJob(id);
    if (!job) throw importNotFound(id);
    if (query.format === 'csv') {
      void reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="import-${id}-issues.csv"`);
      return issuesToCsv(await this.imports.allIssues(id));
    }
    const { items, total } = await this.imports.listIssues(id, query.severity, query.page, query.pageSize);
    return { data: items, page: pageMeta(query.page, query.pageSize, total) };
  }
}
