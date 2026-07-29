import { Bar, BarChart, Cell, LabelList, XAxis, YAxis } from 'recharts';
import type { Props as RechartsLabelProps } from 'recharts/types/component/Label';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '~/components/ui/chart';
import type { TransactionCategoryDatum } from '~/lib/transactions';

type CategoryBarChartProps = {
  chartData: TransactionCategoryDatum[];
  chartConfig: ChartConfig;
  selectedKey?: string | null;
  onSelectCategory?: (key: string | null) => void;
};

type BarLabelProps = RechartsLabelProps & {
  width?: number | string;
  height?: number | string;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDeltaPct(deltaPct: number) {
  const rounded = Math.round(deltaPct);
  if (rounded > 0) {
    return `+${rounded}%`;
  }
  return `${rounded}%`;
}

function createBarLabelContent(chartData: TransactionCategoryDatum[]) {
  return function BarLabelContent(props: BarLabelProps) {
    const { x = 0, y = 0, width = 0, height = 0, value = 0, index = 0 } =
      props;
    const datum = chartData[index ?? 0];
    if (!datum) {
      return <text />;
    }

    const labelX = Number(x) + Number(width) + 8;
    const labelY = Number(y) + Number(height) / 2;

    return (
      <text
        x={labelX}
        y={labelY}
        className='fill-foreground text-xs'
        dominantBaseline='middle'
      >
        <tspan>{formatCurrency(Number(value))}</tspan>
        {datum.deltaPct !== null ? (
          <tspan className='fill-muted-foreground' dx={6}>
            {formatDeltaPct(datum.deltaPct)}
          </tspan>
        ) : null}
      </text>
    );
  };
}

export function CategoryBarChart({
  chartData,
  chartConfig,
  selectedKey = null,
  onSelectCategory,
}: CategoryBarChartProps) {
  const height = Math.max(chartData.length * 44, 200);
  const hasSelection = selectedKey != null;

  function handleBarClick(entry: TransactionCategoryDatum) {
    if (!onSelectCategory) {
      return;
    }
    onSelectCategory(selectedKey === entry.key ? null : entry.key);
  }

  return (
    <Card className='flex flex-col'>
      <CardHeader className='pb-2'>
        <CardTitle>Spending by category</CardTitle>
        <CardDescription>
          Where your money goes — change vs last month&apos;s pace
        </CardDescription>
      </CardHeader>
      <CardContent className='flex-1'>
        <ChartContainer
          config={chartConfig}
          className='aspect-auto w-full'
          style={{ height }}
        >
          <BarChart
            accessibilityLayer
            data={chartData}
            layout='vertical'
            margin={{ left: 0, right: 112, top: 4, bottom: 4 }}
          >
            <XAxis type='number' hide />
            <YAxis
              type='category'
              dataKey='category'
              width={120}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
            />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent nameKey='key' hideLabel />}
            />
            <Bar
              dataKey='total'
              radius={4}
              className={onSelectCategory ? 'cursor-pointer' : undefined}
            >
              {chartData.map((entry) => (
                <Cell
                  key={entry.key}
                  fill={entry.fill}
                  fillOpacity={
                    hasSelection && entry.key !== selectedKey ? 0.35 : 1
                  }
                  className={onSelectCategory ? 'cursor-pointer' : undefined}
                  onClick={() => handleBarClick(entry)}
                />
              ))}
              <LabelList
                dataKey='total'
                position='right'
                content={createBarLabelContent(chartData)}
              />
            </Bar>
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
