import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Search,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { DashboardItemData } from '~/components/dashboard/item-panel';
import { ItemControls } from '~/components/dashboard/item-controls';
import type {
  CumulativeSpendingPoint,
  DashboardModel,
} from '~/lib/dashboard';
import {
  filterDashboardTransactions,
  formatCategoryLabel,
  formatMonthLabel,
  transactionCategoryKey,
  transactionPeriodRange,
  type DashboardPeriod,
} from '~/lib/transactions';

function formatCurrency(value: number, fractionDigits = 0): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

function formatTransactionAmount(amount: number, currency: string | null): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency ?? 'USD',
  }).format(amount * -1);
}

function pointsFor(data: CumulativeSpendingPoint[], max: number): string {
  const width = 760;
  const height = 260;
  return data
    .map((point, index) => {
      const x = data.length === 1 ? width : (index / (data.length - 1)) * width;
      return `${x},${height - (point.total / max) * height}`;
    })
    .join(' ');
}

function MonthPicker({
  month,
  months,
  onChange,
}: {
  month: string;
  months: string[];
  onChange: (month: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <div ref={rootRef} className='relative'>
      <button
        type='button'
        aria-haspopup='listbox'
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className='flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-400 transition-colors duration-200 ease-out hover:bg-white/5 hover:text-white'
      >
        <CalendarDays className='size-3.5' /> {formatMonthLabel(month)}
        <ChevronDown
          className={`size-3 transition-transform duration-200 ease-out ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open ? (
        <div
          role='listbox'
          aria-label='Spending month'
          className='absolute right-0 top-[calc(100%+8px)] z-20 max-h-72 w-44 origin-top-right overflow-y-auto rounded-xl border border-white/10 bg-[#17171b] p-1.5 shadow-2xl shadow-black/40'
        >
          {months.map((option) => (
            <button
              key={option}
              type='button'
              role='option'
              aria-selected={option === month}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-xs transition-colors duration-200 ease-out ${option === month ? 'bg-indigo-400/10 text-indigo-200' : 'text-zinc-400 hover:bg-white/5 hover:text-white'}`}
            >
              {formatMonthLabel(option)}
              {option === month ? <Check className='size-3.5' /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function formatRange(startDate: string, endDate: string): string {
  const month = new Date(`${startDate}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    timeZone: 'UTC',
  });
  const startDay = Number(startDate.slice(8, 10));
  const endDay = Number(endDate.slice(8, 10));
  return startDay === endDay
    ? `${month} ${startDay}`
    : `${month} ${startDay}-${endDay}`;
}

export function SignalDashboard({
  model,
  availableMonths,
  items,
  isSandbox,
  onMonthChange,
}: {
  model: DashboardModel;
  availableMonths: string[];
  items: DashboardItemData[];
  isSandbox: boolean;
  onMonthChange: (month: string) => void;
}) {
  const [selected, setSelected] = useState<string | 'all'>('all');
  const [period, setPeriod] = useState<DashboardPeriod>('month');
  const [query, setQuery] = useState('');
  const workspaceRef = useRef<HTMLElement>(null);
  const currentTotal = model.summary.total;
  const comparisonTotal = model.summary.previousTotal;
  const difference = comparisonTotal - currentTotal;
  const isLower = difference >= 0;
  const deltaPct =
    model.summary.deltaPct === null ? null : Math.abs(model.summary.deltaPct);
  const chartMax = Math.max(currentTotal, comparisonTotal, 1) * 1.08;
  const visible = filterDashboardTransactions(
    model.transactions,
    model.boundary,
    period,
    selected,
    query,
  );
  const periodTotal = visible.reduce(
    (sum, transaction) => sum + transaction.amount,
    0,
  );
  const periodRange = transactionPeriodRange(model.boundary, period);
  const categoryByKey = new Map(
    model.categories.map((category) => [category.key, category]),
  );

  function changeMonth(month: string) {
    setSelected('all');
    setQuery('');
    setPeriod('month');
    onMonthChange(month);
  }

  function inspectWatchCategory() {
    if (!model.insights.watchCategory) return;
    setSelected(model.insights.watchCategory);
    setQuery('');
    setPeriod('month');
    requestAnimationFrame(() => workspaceRef.current?.scrollIntoView());
  }

  function clearFilters() {
    setQuery('');
    setSelected('all');
    setPeriod('month');
  }

  return (
    <main className='min-h-screen bg-[#0b0b0e] px-4 pb-16 text-zinc-100 sm:px-7'>
      <div className='mx-auto max-w-7xl'>
        <header className='flex min-h-20 flex-wrap items-center justify-between gap-3 py-4'>
          <div className='flex items-center gap-3'>
            <span className='font-heading text-lg font-semibold tracking-tight'>
              Finanz
            </span>
            {isSandbox ? (
              <span className='rounded-full border border-amber-300/15 bg-amber-300/[0.06] px-2 py-1 text-[9px] uppercase tracking-wider text-amber-200/70'>
                Sandbox
              </span>
            ) : null}
          </div>
          <div className='flex items-center gap-2'>
            <MonthPicker
              month={model.month}
              months={availableMonths}
              onChange={changeMonth}
            />
            <ItemControls items={items} />
          </div>
        </header>

        <section className='overflow-hidden rounded-3xl border border-white/10 bg-[#101014]'>
          <div className='grid lg:grid-cols-[0.68fr_0.32fr]'>
            <div className='p-6 sm:p-9'>
              <div className='flex flex-wrap items-start justify-between gap-5'>
                <div>
                  <p className='text-xs uppercase tracking-[0.16em] text-zinc-500'>
                    {model.boundary.isCurrentMonth
                      ? 'Month-to-date spending'
                      : 'Full-month spending'}
                  </p>
                  <p className='mt-3 font-heading text-5xl font-semibold tracking-[-0.045em] sm:text-6xl'>
                    {formatCurrency(currentTotal)}
                  </p>
                </div>
                <div
                  className={`rounded-xl px-4 py-3 text-right ${isLower ? 'bg-emerald-400/10' : 'bg-rose-400/10'}`}
                >
                  {model.summary.hasPreviousData ? (
                    <>
                      <p
                        className={`flex items-center gap-1 text-sm font-medium ${isLower ? 'text-emerald-300' : 'text-rose-300'}`}
                      >
                        {isLower ? (
                          <ArrowDownRight className='size-4' />
                        ) : (
                          <ArrowUpRight className='size-4' />
                        )}
                        {formatCurrency(Math.abs(difference))}{' '}
                        {isLower ? 'below' : 'above'} {model.previousMonthLabel}
                      </p>
                      <p
                        className={`mt-1 text-xs ${isLower ? 'text-emerald-300/60' : 'text-rose-300/60'}`}
                      >
                        {deltaPct === null ? 'No percentage' : `${deltaPct.toFixed(1)}%`}
                        {' · '}
                        {model.boundary.isCurrentMonth
                          ? `through the ${model.boundary.throughDay}${ordinalSuffix(model.boundary.throughDay)}`
                          : 'full month'}
                      </p>
                    </>
                  ) : (
                    <p className='text-sm text-zinc-400'>No prior month data</p>
                  )}
                </div>
              </div>

              <div className='mt-10'>
                <svg
                  viewBox='0 0 760 290'
                  className='h-auto w-full overflow-visible'
                  role='img'
                  aria-label={`Cumulative spending through ${model.shortMonthLabel} ${model.boundary.throughDay} compared with ${model.previousMonthLabel}`}
                >
                  {[0, 1, 2, 3].map((line) => (
                    <line
                      key={line}
                      x1='0'
                      x2='760'
                      y1={line * 86.7}
                      y2={line * 86.7}
                      stroke='rgba(255,255,255,.07)'
                    />
                  ))}
                  <polyline
                    points={pointsFor(model.previousCumulative, chartMax)}
                    fill='none'
                    stroke='rgba(161,161,170,.45)'
                    strokeWidth='2'
                    strokeDasharray='5 7'
                    vectorEffect='non-scaling-stroke'
                  />
                  <polyline
                    points={pointsFor(model.currentCumulative, chartMax)}
                    fill='none'
                    stroke='#818cf8'
                    strokeWidth='3'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    vectorEffect='non-scaling-stroke'
                  />
                  <circle
                    cx='760'
                    cy={260 - (currentTotal / chartMax) * 260}
                    r='5'
                    fill='#0f0f13'
                    stroke='#a5b4fc'
                    strokeWidth='3'
                  />
                  <text x='0' y='286' fill='#71717a' fontSize='11'>
                    {model.shortMonthLabel.slice(0, 3)} 1
                  </text>
                  <text
                    x='760'
                    y='286'
                    fill='#71717a'
                    fontSize='11'
                    textAnchor='end'
                  >
                    {model.shortMonthLabel.slice(0, 3)}{' '}
                    {model.boundary.throughDay}
                  </text>
                </svg>
                <div className='mt-1 flex items-center gap-5 text-xs text-zinc-500'>
                  <span className='flex items-center gap-2'>
                    <i className='h-0.5 w-5 bg-indigo-400' />
                    {model.shortMonthLabel}
                  </span>
                  <span className='flex items-center gap-2'>
                    <i className='h-0.5 w-5 border-t border-dashed border-zinc-500' />
                    {model.previousMonthLabel}
                  </span>
                </div>
              </div>
            </div>

            <aside className='border-t border-white/10 bg-white/[0.018] p-6 sm:p-9 lg:border-l lg:border-t-0'>
              <p className='text-xs uppercase tracking-[0.16em] text-zinc-500'>
                Read the month
              </p>
              <h1 className='mt-5 font-heading text-3xl font-semibold leading-tight tracking-tight'>
                {model.insights.headline}
              </h1>
              <p className='mt-4 text-sm leading-6 text-zinc-400'>
                {model.insights.summary}
              </p>
              <div className='mt-8 space-y-3'>
                <div className='flex gap-3 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.06] p-4'>
                  <span className='mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-400 text-black'>
                    <Check className='size-3' />
                  </span>
                  <div>
                    <p className='text-sm font-medium'>
                      {model.insights.goodTitle}
                    </p>
                    <p className='mt-1 text-xs leading-5 text-zinc-500'>
                      {model.insights.goodDetail}
                    </p>
                  </div>
                </div>
                <button
                  type='button'
                  onClick={inspectWatchCategory}
                  disabled={!model.insights.watchCategory}
                  className='group flex w-full gap-3 rounded-xl border border-rose-400/15 bg-rose-400/[0.06] p-4 text-left transition-colors duration-200 ease-out hover:bg-rose-400/10 disabled:cursor-default'
                >
                  <ArrowUpRight className='mt-0.5 size-5 shrink-0 text-rose-400' />
                  <div className='flex-1'>
                    <p className='text-sm font-medium'>
                      {model.insights.watchTitle}
                    </p>
                    <p className='mt-1 text-xs leading-5 text-zinc-500'>
                      {model.insights.watchDetail}
                    </p>
                  </div>
                  {model.insights.watchCategory ? (
                    <ChevronRight className='size-4 self-center text-zinc-600 transition-transform duration-200 ease-out group-hover:translate-x-0.5' />
                  ) : null}
                </button>
              </div>
            </aside>
          </div>
        </section>

        <section
          ref={workspaceRef}
          className='mt-6 grid min-h-[680px] scroll-mt-5 overflow-hidden rounded-2xl border border-white/10 bg-[#101013] lg:grid-cols-[280px_1fr]'
        >
          <aside className='border-b border-white/10 lg:border-b-0 lg:border-r'>
            <div className='border-b border-white/10 p-4'>
              <p className='text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-600'>
                Categories
              </p>
              <button
                type='button'
                onClick={() => setSelected('all')}
                className={`mt-3 flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm ${selected === 'all' ? 'bg-white/[0.08] text-white' : 'text-zinc-400 hover:bg-white/[0.04]'}`}
              >
                <span>All spending</span>
                <span className='text-xs tabular-nums'>
                  {formatCurrency(currentTotal)}
                </span>
              </button>
            </div>
            <div className='p-2'>
              {model.categories.map((category) => (
                <button
                  key={category.key}
                  type='button'
                  onClick={() => setSelected(category.key)}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-3 text-left transition-colors duration-200 ease-out ${selected === category.key ? 'bg-indigo-400/10 text-white' : 'text-zinc-400 hover:bg-white/[0.04] hover:text-white'}`}
                >
                  <span
                    className='size-2 rounded-full'
                    style={{ backgroundColor: category.color }}
                  />
                  <span className='min-w-0 flex-1 truncate text-xs'>
                    {category.label}
                  </span>
                  <span className='text-xs tabular-nums'>
                    {formatCurrency(category.total)}
                  </span>
                  <span
                    className={`w-9 text-right text-[10px] ${category.deltaPct === null ? 'text-zinc-600' : category.deltaPct > 0 ? 'text-rose-400' : category.deltaPct < 0 ? 'text-emerald-400' : 'text-zinc-600'}`}
                  >
                    {category.deltaPct === null
                      ? 'New'
                      : `${category.deltaPct > 0 ? '+' : ''}${category.deltaPct.toFixed(0)}%`}
                  </span>
                </button>
              ))}
            </div>
            <div className='m-4 rounded-lg border border-rose-400/15 bg-rose-400/[0.05] p-3'>
              <p className='text-xs font-medium text-rose-300'>
                {model.insights.watchTitle}
              </p>
              <p className='mt-1 text-[11px] leading-4 text-zinc-500'>
                {model.insights.alertDetail}
              </p>
              {model.insights.watchCategory ? (
                <button
                  type='button'
                  onClick={() => setSelected(model.insights.watchCategory!)}
                  className='mt-3 text-[11px] text-zinc-300 hover:text-white'
                >
                  Inspect category
                </button>
              ) : null}
            </div>
          </aside>

          <div className='min-w-0'>
            <div className='flex flex-wrap items-center gap-2 border-b border-white/10 p-3'>
              <div className='relative min-w-[220px] flex-1 sm:max-w-sm'>
                <Search className='absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600' />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder='Search Transactions'
                  className='h-9 w-full rounded-lg border border-white/10 bg-black/20 pl-9 pr-8 text-xs outline-none placeholder:text-zinc-700 focus:border-indigo-400/50'
                />
                {query ? (
                  <button
                    type='button'
                    aria-label='Clear search'
                    onClick={() => setQuery('')}
                    className='absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-white'
                  >
                    <X className='size-3.5' />
                  </button>
                ) : null}
              </div>
              <div className='flex items-center rounded-lg border border-white/10 bg-black/20 p-0.5'>
                {(
                  [
                    {
                      value: 'month',
                      label: model.boundary.isCurrentMonth
                        ? 'Month to date'
                        : 'Full month',
                    },
                    { value: 'last7', label: 'Last 7 days' },
                    {
                      value: 'end',
                      label: model.boundary.isCurrentMonth
                        ? 'Today'
                        : 'Last day',
                    },
                  ] as Array<{ value: DashboardPeriod; label: string }>
                ).map(({ value, label }) => (
                  <button
                    key={value}
                    type='button'
                    onClick={() => setPeriod(value)}
                    className={`rounded-md px-3 py-2 text-[11px] transition-colors duration-200 ease-out ${period === value ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-white'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className='flex h-9 items-center gap-2 rounded-lg border border-white/10 px-3 text-[11px] text-zinc-500'>
                <CalendarDays className='size-3.5' />
                {formatRange(periodRange.startDate, periodRange.endDate)}
              </span>
            </div>

            <div className='flex items-center justify-between border-b border-white/10 bg-white/[0.015] px-5 py-4'>
              <div>
                <h2 className='font-heading text-lg font-semibold'>
                  {selected === 'all'
                    ? 'All Transactions'
                    : categoryByKey.get(selected)?.label}
                </h2>
                <p className='mt-1 text-[11px] text-zinc-600'>
                  {visible.length} results · All Linked Accounts
                </p>
              </div>
              <div className='text-right'>
                <p className='text-xs text-zinc-500'>Visible total</p>
                <p className='mt-1 text-sm font-semibold tabular-nums'>
                  {formatCurrency(periodTotal, 2)}
                </p>
              </div>
            </div>

            <div className='overflow-x-auto'>
              <table className='w-full min-w-[720px] text-left'>
                <thead className='border-b border-white/10 text-[10px] uppercase tracking-[0.12em] text-zinc-600'>
                  <tr>
                    <th className='px-5 py-3 font-medium'>Date</th>
                    <th className='px-5 py-3 font-medium'>Merchant</th>
                    <th className='px-5 py-3 font-medium'>Category</th>
                    <th className='px-5 py-3 text-right font-medium'>Amount</th>
                  </tr>
                </thead>
                <tbody className='divide-y divide-white/[0.06]'>
                  {visible.map((transaction) => {
                    const categoryKey = transactionCategoryKey(transaction);
                    const category = categoryByKey.get(categoryKey);
                    return (
                      <tr
                        key={transaction.transactionId}
                        className='text-xs transition-colors duration-200 ease-out hover:bg-white/[0.025]'
                      >
                        <td className='px-5 py-4 text-zinc-600'>
                          {transaction.date.slice(5).replace('-', '/')}
                        </td>
                        <td className='px-5 py-4'>
                          <p className='font-medium text-zinc-200'>
                            {transaction.merchantName ?? transaction.name}
                          </p>
                          <p className='mt-1 text-[10px] text-zinc-600'>
                            {transaction.pending ? 'Pending · ' : ''}
                            {transaction.personalFinanceCategory
                              ? formatCategoryLabel(
                                  transaction.personalFinanceCategory.detailed,
                                )
                              : 'No category detail'}
                          </p>
                        </td>
                        <td className='px-5 py-4'>
                          <span className='inline-flex items-center gap-2 text-zinc-400'>
                            <i
                              className='size-1.5 rounded-full'
                              style={{
                                backgroundColor: category?.color ?? '#a1a1aa',
                              }}
                            />
                            {category?.label ?? 'Uncategorized'}
                          </span>
                        </td>
                        <td className='px-5 py-4 text-right font-medium tabular-nums'>
                          {formatTransactionAmount(
                            transaction.amount,
                            transaction.isoCurrencyCode,
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {visible.length === 0 ? (
                <div className='py-20 text-center'>
                  <p className='text-sm text-zinc-400'>
                    No matching Transactions
                  </p>
                  <button
                    type='button'
                    onClick={clearFilters}
                    className='mt-3 text-xs text-indigo-300 hover:text-indigo-200'
                  >
                    Clear filters
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function ordinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return 'th';
  if (day % 10 === 1) return 'st';
  if (day % 10 === 2) return 'nd';
  if (day % 10 === 3) return 'rd';
  return 'th';
}
