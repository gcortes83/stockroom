import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { AlertTriangle, ArrowLeft, Download, FilePlus2, FileX2, RefreshCcw, ScanLine, Sparkles, Equal } from 'lucide-react';
import type { IssueSeverity } from '@stockroom/contracts';
import { api } from '@/shared/api/endpoints';
import { describeError } from '@/shared/api/http';
import { keys } from '@/shared/api/keys';
import { cn } from '@/shared/lib/cn';
import { dateTime, humanize } from '@/shared/lib/format';
import { buttonStyles } from '@/shared/ui/button';
import { ErrorState, Skeleton } from '@/shared/ui/feedback';
import { Pagination } from '@/shared/ui/pagination';
import { Badge, Glass, PageHeader } from '@/shared/ui/surface';
import { IMPORT_LABEL, IMPORT_TONE } from './ImportsPage';

function ScoreRing({ score }: { score: number }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="relative h-36 w-36">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <defs>
          <linearGradient id="score-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="55%" stopColor="var(--accent-2)" />
            <stop offset="100%" stopColor="var(--accent-3)" />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--line)" strokeWidth="10" />
        <motion.circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="url(#score-gradient)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - score / 100) }}
          transition={{ duration: 1.1, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="text-3xl font-semibold tabular-nums">{score}%</div>
          <div className="text-[10px] tracking-wide text-muted uppercase">rows accepted</div>
        </div>
      </div>
    </div>
  );
}

export function ImportReportPage() {
  const { id = '' } = useParams();
  const [page, setPage] = useState(1);
  const [severity, setSeverity] = useState<IssueSeverity | undefined>(undefined);
  const job = useQuery({ queryKey: keys.importJob(id), queryFn: () => api.importJob(id) });
  const issues = useQuery({
    queryKey: keys.importIssues(id, page, severity),
    queryFn: () => api.importIssues(id, page, severity),
    placeholderData: keepPreviousData,
  });

  if (job.isLoading) return <Skeleton className="h-96 rounded-3xl" />;
  if (job.isError || !job.data) return <ErrorState message={describeError(job.error)} onRetry={() => void job.refetch()} />;

  const data = job.data;
  const totals = data.totals;
  const score = totals.processedRows > 0 ? Math.round(((totals.processedRows - totals.rejected) / totals.processedRows) * 100) : 0;
  const tiles = [
    { label: 'Created', value: totals.created, icon: FilePlus2, tone: 'text-success' },
    { label: 'Updated', value: totals.updated, icon: RefreshCcw, tone: 'text-accent-3' },
    { label: 'Unchanged', value: totals.unchanged, icon: Equal, tone: 'text-muted' },
    { label: 'Rejected', value: totals.rejected, icon: FileX2, tone: 'text-danger' },
    { label: 'Warnings', value: totals.warnings, icon: AlertTriangle, tone: 'text-warning' },
    { label: 'Blank lines', value: totals.blankLines, icon: ScanLine, tone: 'text-subtle' },
  ];

  return (
    <div>
      <Link to="/admin/imports" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> All imports
      </Link>
      <PageHeader
        eyebrow="Data quality report"
        title={<span className="break-all">{data.filename}</span>}
        description={`Started ${dateTime(data.startedAt)} · ${totals.totalLines} data lines · ${totals.processedRows} processed`}
        actions={
          (totals.rejected > 0 || totals.warnings > 0) && (
            <a href={api.importIssuesCsvUrl(id)} download className={buttonStyles('secondary')}>
              <Download className="h-4 w-4" /> Download issues CSV
            </a>
          )
        }
      />
      <div className="mb-6 grid gap-4 lg:grid-cols-[auto_1fr]">
        <Glass className="flex flex-col items-center justify-center gap-3 p-6">
          <ScoreRing score={score} />
          <Badge tone={IMPORT_TONE[data.status]}>{IMPORT_LABEL[data.status]}</Badge>
        </Glass>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {tiles.map(({ label, value, icon: Icon, tone }, index) => (
            <motion.div key={label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
              <Glass className="h-full p-4">
                <div className={cn('flex items-center gap-1.5 text-xs', tone)}>
                  <Icon className="h-3.5 w-3.5" /> {label}
                </div>
                <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
              </Glass>
            </motion.div>
          ))}
        </div>
      </div>
      {data.failureMessage && (
        <div role="alert" className="mb-6 rounded-2xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
          {data.failureMessage}
        </div>
      )}
      <Glass className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <Sparkles className="h-4 w-4 text-accent" /> Row issues
          </h2>
          <div className="flex gap-1 rounded-xl bg-surface-2 p-1" role="tablist">
            {([undefined, 'ERROR', 'WARNING'] as const).map((value) => (
              <button
                key={value ?? 'all'}
                type="button"
                role="tab"
                aria-selected={severity === value}
                onClick={() => {
                  setSeverity(value);
                  setPage(1);
                }}
                className={cn('rounded-lg px-3 py-1 text-xs transition-colors', severity === value ? 'bg-bg text-fg shadow' : 'text-muted hover:text-fg')}
              >
                {value ? humanize(value) + 's' : 'All'}
              </button>
            ))}
          </div>
        </div>
        {issues.isError ? (
          <div className="p-4">
            <ErrorState message={describeError(issues.error)} onRetry={() => void issues.refetch()} />
          </div>
        ) : issues.data?.data.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted">No issues. Every row made it in. ✨</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] tracking-wide text-subtle uppercase">
                  <th className="px-4 py-3 font-medium">Line</th>
                  <th className="px-4 py-3 font-medium">SKU</th>
                  <th className="px-4 py-3 font-medium">Field</th>
                  <th className="px-4 py-3 font-medium">Value</th>
                  <th className="px-4 py-3 font-medium">Issue</th>
                </tr>
              </thead>
              <tbody className={cn(issues.isPlaceholderData && 'opacity-60')}>
                {issues.data?.data.map((issue, index) => (
                  <tr key={`${issue.line}-${issue.code}-${index}`} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-3 font-mono text-xs tabular-nums">{issue.line}</td>
                    <td className="px-4 py-3 font-mono text-xs">{issue.sku ?? '—'}</td>
                    <td className="px-4 py-3 text-muted">{issue.field ?? '—'}</td>
                    <td className="max-w-48 truncate px-4 py-3 font-mono text-xs" title={issue.value ?? ''}>
                      {issue.value === null ? '—' : issue.value === '' ? <span className="text-subtle">(empty)</span> : issue.value}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-start gap-2">
                        <Badge tone={issue.severity === 'ERROR' ? 'danger' : 'warning'}>{issue.code}</Badge>
                        <span className="text-xs text-muted">{issue.message}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Glass>
      {issues.data && <Pagination page={issues.data.page} onChange={setPage} />}
    </div>
  );
}
