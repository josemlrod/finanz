import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '~/components/ui/chart';
import type { DailySpendingRow } from '~/lib/transactions';

type SpendingAreaChartProps = {
  chartData: DailySpendingRow[];
  seriesKeys: string[];
  chartConfig: ChartConfig;
  monthLabel: string;
};

function formatTooltipDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function SpendingAreaChart({
  chartData,
  seriesKeys,
  chartConfig,
  monthLabel,
}: SpendingAreaChartProps) {
  return (
    <Card className='flex flex-col'>
      <CardHeader className='pb-2'>
        <CardTitle>Daily spending</CardTitle>
        <CardDescription>{monthLabel}</CardDescription>
      </CardHeader>
      <CardContent className='flex-1'>
        <ChartContainer
          config={chartConfig}
          className='aspect-auto h-[300px] w-full'
        >
          <AreaChart
            accessibilityLayer
            data={chartData}
            margin={{ left: 0, right: 0, top: 4, bottom: 0 }}
          >
            <defs>
              {seriesKeys.map((key) => (
                <linearGradient
                  key={key}
                  id={`fill-${key}`}
                  x1='0'
                  y1='0'
                  x2='0'
                  y2='1'
                >
                  <stop
                    offset='5%'
                    stopColor={`var(--color-${key})`}
                    stopOpacity={0.8}
                  />
                  <stop
                    offset='95%'
                    stopColor={`var(--color-${key})`}
                    stopOpacity={0.1}
                  />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey='day'
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              interval={4}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) => {
                    const date = payload?.[0]?.payload?.date;
                    return typeof date === 'string'
                      ? formatTooltipDate(date)
                      : '';
                  }}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            {seriesKeys.map((key) => (
              <Area
                key={key}
                type='monotone'
                dataKey={key}
                stackId='spending'
                stroke={`var(--color-${key})`}
                fill={`url(#fill-${key})`}
              />
            ))}
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
