import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { CheckCircle2, FileSpreadsheet, FileUp, History, UploadCloud, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { MAX_IMPORT_BYTES, REQUIRED_CSV_COLUMNS, type ImportJob } from '@stockroom/contracts';
import { api, uploadCsv } from '@/shared/api/endpoints';
import { describeError, ProblemError } from '@/shared/api/http';
import { keys } from '@/shared/api/keys';
import { cn } from '@/shared/lib/cn';
import { relative } from '@/shared/lib/format';
import { ErrorState, Skeleton } from '@/shared/ui/feedback';
import { Pagination } from '@/shared/ui/pagination';
import { Badge, Glass, PageHeader } from '@/shared/ui/surface';

export const IMPORT_TONE: Record<ImportJob['status'], 'info' | 'success' | 'warning' | 'danger'> = {
  PROCESSING: 'info',
  COMPLETED: 'success',
  COMPLETED_WITH_ERRORS: 'warning',
  FAILED: 'danger',
};

export const IMPORT_LABEL: Record<ImportJob['status'], string> = {
  PROCESSING: 'Processing',
  COMPLETED: 'Completed',
  COMPLETED_WITH_ERRORS: 'Completed with issues',
  FAILED: 'Failed',
};

export function ImportsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const history = useQuery({ queryKey: keys.importList(page), queryFn: () => api.imports(page) });

  const upload = useMutation({
    mutationFn: (file: File) => uploadCsv(file, setProgress),
    onSuccess: async (job) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.imports }),
        queryClient.invalidateQueries({ queryKey: keys.products }),
        queryClient.invalidateQueries({ queryKey: keys.categories }),
      ]);
      toast.success(`Import finished: ${job.totals.created} created, ${job.totals.updated} updated, ${job.totals.rejected} rejected`);
      void navigate(`/admin/imports/${job.id}`);
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: keys.imports });
      const jobId = error instanceof ProblemError ? (error.problem.jobId as string | undefined) : undefined;
      toast.error(describeError(error), jobId ? { action: { label: 'View', onClick: () => void navigate(`/admin/imports/${jobId}`) } } : undefined);
    },
    onSettled: () => setProgress(null),
  });

  const accept = (file: File | undefined) => {
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      toast.error('Please choose a .csv file');
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      toast.error('The file is larger than 5 MB');
      return;
    }
    upload.mutate(file);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Studio"
        title="Import products"
        description="Upload a CSV and every row is validated, normalised and upserted by SKU. Bad rows are reported, never silently dropped."
      />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <motion.button
            type="button"
            whileHover={{ scale: 1.005 }}
            onClick={() => input.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              accept(event.dataTransfer.files[0]);
            }}
            disabled={upload.isPending}
            className={cn(
              'ai-border glass-strong flex w-full flex-col items-center justify-center gap-4 rounded-[2rem] px-6 py-16 text-center transition-all',
              dragging && 'scale-[1.01] shadow-[0_30px_80px_-30px_rgb(167_139_250/0.8)]',
            )}
          >
            <div className="bg-ai grid h-16 w-16 place-items-center rounded-3xl shadow-[0_16px_40px_-12px_rgb(167_139_250/0.8)]">
              {upload.isPending ? <FileSpreadsheet className="h-7 w-7 animate-pulse text-white" /> : <UploadCloud className="h-7 w-7 text-white" />}
            </div>
            {upload.isPending ? (
              <div className="w-full max-w-sm space-y-3">
                <div className="shimmer-text font-medium">{progress !== null && progress < 1 ? 'Uploading…' : 'Validating every row…'}</div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                  <motion.div className="bg-ai h-full" animate={{ width: `${Math.round((progress ?? 1) * 100)}%` }} />
                </div>
              </div>
            ) : (
              <>
                <div className="text-lg font-semibold">Drop your CSV here</div>
                <div className="text-sm text-muted">or click to browse · up to 5 MB · 50,000 rows</div>
              </>
            )}
          </motion.button>
          <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => {
            accept(event.target.files?.[0]);
            event.target.value = '';
          }} />
          <Glass className="p-5">
            <div className="mb-3 text-xs font-medium text-muted">Expected columns (any order, case-insensitive)</div>
            <div className="flex flex-wrap gap-2">
              {REQUIRED_CSV_COLUMNS.map((column) => (
                <code key={column} className="rounded-lg border border-line bg-surface-2 px-2 py-1 font-mono text-xs">
                  {column}
                </code>
              ))}
            </div>
            <ul className="mt-4 grid gap-1.5 text-xs text-muted sm:grid-cols-2">
              <li>• Prices like $29.99 or 1,299.00 are normalised</li>
              <li>• Duplicate SKUs in a file: last row wins</li>
              <li>• Existing SKUs are updated (upsert)</li>
              <li>• Blank lines are skipped silently</li>
            </ul>
          </Glass>
        </div>
        <Glass className="h-fit p-5">
          <h2 className="mb-4 flex items-center gap-2 font-semibold">
            <History className="h-4 w-4 text-accent" /> Import history
          </h2>
          {history.isError ? (
            <ErrorState message={describeError(history.error)} onRetry={() => void history.refetch()} />
          ) : history.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-16" />
              ))}
            </div>
          ) : history.data?.data.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">No imports yet.</p>
          ) : (
            <ul className="space-y-2">
              {history.data?.data.map((job) => (
                <li key={job.id}>
                  <Link to={`/admin/imports/${job.id}`} className="block rounded-2xl border border-line p-3 transition-colors hover:border-line-strong hover:bg-surface-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        {job.status === 'FAILED' ? <XCircle className="h-4 w-4 shrink-0 text-danger" /> : job.status === 'COMPLETED' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" /> : <FileUp className="h-4 w-4 shrink-0 text-warning" />}
                        <span className="truncate text-sm font-medium">{job.filename}</span>
                      </div>
                      <Badge tone={IMPORT_TONE[job.status]}>{IMPORT_LABEL[job.status]}</Badge>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-muted">
                      <span>{relative(job.startedAt)}</span>
                      {job.source === 'SEED' && <span className="text-accent">seeded on first start</span>}
                      <span>+{job.totals.created} new</span>
                      <span>{job.totals.updated} updated</span>
                      <span className={job.totals.rejected ? 'text-danger' : ''}>{job.totals.rejected} rejected</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {history.data && <Pagination page={history.data.page} onChange={setPage} />}
        </Glass>
      </div>
    </div>
  );
}
