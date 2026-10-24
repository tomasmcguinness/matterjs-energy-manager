'use client'

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { Forecast } from "./device.ts";
import { dayDomain, dayTicks, formatTime, Y_AXIS_WIDTH } from './timeline.ts';

type EnergyTimelineProps = {
    forecast?: Forecast | null;
    currentTime?: Date;
};

const ForecastTimeline = ({ forecast, currentTime = new Date() }: EnergyTimelineProps) => {

    if (forecast == null) {
        return <div className="alert alert-info" style={{ marginBottom: '0' }}>No power usage currently forecast</div>;
    }

    // Turn the slots into a step series: each slot's power from its start
    // until the next slot begins, dropping to zero at the end of the forecast.
    //
    let time = forecast.startTime * 1000;

    const data = forecast.slots.map(slot => {
        const point = { time, power: slot.nominalPower / 1000000 }; // milliwatts to kilowatts
        time += slot.defaultDuration * 1000;
        return point;
    });

    data.push({ time, power: 0 });

    return <div>
        <AreaChart style={{ width: '100%', height: '200px' }} responsive data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" type="number" scale="time" domain={dayDomain(currentTime)} ticks={dayTicks(currentTime)} tickFormatter={formatTime} allowDataOverflow />
            <YAxis width={Y_AXIS_WIDTH} unit="kW" />
            <Tooltip labelFormatter={formatTime} formatter={(value: number) => [`${value.toFixed(3)}kW`, 'Power']} />
            <Area type="stepAfter" dataKey="power" stroke="#4A90E2" fill="#4A90E2" fillOpacity={0.6} isAnimationActive={false} />
            <ReferenceLine strokeDasharray="3 3" x={currentTime.getTime()} stroke="red" />
        </AreaChart>
        <div className="text-muted small">
            Starts {formatTime(forecast.startTime * 1000)} · Ends {formatTime(time)}
        </div>
    </div>;
}

export default ForecastTimeline;
