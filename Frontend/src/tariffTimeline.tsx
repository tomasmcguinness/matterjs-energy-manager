'use client'

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from 'recharts';
import { dayDomain, dayTicks, formatTime, Y_AXIS_WIDTH } from './timeline.ts';

type TariffTimelineProps = {
    prices: any[];
    currentTime?: Date;
};

const TariffTimeline = ({ prices, currentTime = new Date() }: TariffTimelineProps) => {

    if (prices == null || prices.length == 0) {
        return <div className="alert alert-info" style={{ marginBottom: '0' }}>No Tariff Data Available</div>;
    }

    return <LineChart style={{ width: '100%', height: '100%', maxHeight: '30vh', aspectRatio: 1.618 }} responsive data={prices}    >
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="startDate" type="number" scale="time" domain={dayDomain(currentTime)} ticks={dayTicks(currentTime)} tickFormatter={formatTime} allowDataOverflow />
        <YAxis width={Y_AXIS_WIDTH} />
        <Tooltip labelFormatter={formatTime} />
        <Legend />
        <Line type="stepAfter" dataKey="price" stroke="#8884d8" activeDot={{ r: 8 }} />
        <ReferenceLine strokeDasharray="3 3" x={currentTime.getTime()} stroke="red" />
    </LineChart>;
}

export default TariffTimeline;
