'use client'

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { dayDomain, dayTicks, formatTime, Y_AXIS_WIDTH } from './timeline.ts';

// A period's price is per kWh, in whole currency units (e.g. pounds). Times
// are Unix seconds, and a null endTime means the price has no definite end.
//
export type PricePeriod = {
    startTime: number;
    endTime: number | null;
    price: number;
};

export type Prices = {
    currency: string | null;
    periods: PricePeriod[];
};

const CURRENCY_SYMBOLS: { [code: string]: string } = { GBP: '£', EUR: '€', USD: '$' };

type PriceTimelineProps = {
    prices: Prices | null;
    currentTime?: Date;
};

const PriceTimeline = ({ prices, currentTime = new Date() }: PriceTimelineProps) => {

    if (prices == null || prices.periods.length == 0) {
        return <div className="alert alert-info" style={{ marginBottom: '0' }}>No prices available. Commission a pricing server to see electricity prices.</div>;
    }

    const symbol = prices.currency ? (CURRENCY_SYMBOLS[prices.currency] ?? `${prices.currency} `) : '';

    // A step series: each period's price from its start until its end. Where
    // the next period doesn't follow straight on, the line breaks, as there's
    // no price for that time.
    //
    const data: { time: number, price: number | null }[] = [];

    prices.periods.forEach((period, index) => {
        data.push({ time: period.startTime * 1000, price: period.price });

        const next = prices.periods[index + 1];

        if (period.endTime !== null && next?.startTime !== period.endTime) {
            data.push({ time: period.endTime * 1000, price: period.price });
            data.push({ time: period.endTime * 1000, price: null });
        }
    });

    return <LineChart style={{ width: '100%', height: '100%', maxHeight: '30vh', aspectRatio: 1.618 }} responsive data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="time" type="number" scale="time" domain={dayDomain(currentTime)} ticks={dayTicks(currentTime)} tickFormatter={formatTime} allowDataOverflow />
        <YAxis width={Y_AXIS_WIDTH} tickFormatter={(value: number) => `${symbol}${value}`} />
        <Tooltip labelFormatter={formatTime} formatter={(value: number) => [`${symbol}${value.toFixed(4)}/kWh`, 'Price']} />
        <Line type="stepAfter" dataKey="price" stroke="#8884d8" activeDot={{ r: 8 }} isAnimationActive={false} />
        <ReferenceLine strokeDasharray="3 3" x={currentTime.getTime()} stroke="red" />
    </LineChart>;
}

export default PriceTimeline;
