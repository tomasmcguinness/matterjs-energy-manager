'use client'

import { Forecast } from "./device.ts";

type EnergyTimelineProps = {
    forecast?: Forecast | null;
    currentTime?: Date;
};

// The strip starts at midnight today and covers two days, so forecasts that run past midnight stay visible.
const WINDOW_HOURS = 48;
const WINDOW_SECONDS = WINDOW_HOURS * 3600;

const formatTime = (unixSeconds: number) =>
    new Date(unixSeconds * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

const formatPower = (milliwatts: number) => {
    const watts = milliwatts / 1000;
    return Math.abs(watts) >= 1000 ? `${(watts / 1000).toFixed(2)}kW` : `${Math.round(watts)}W`;
};

const ForecastTimeline = ({ forecast, currentTime }: EnergyTimelineProps) => {

    if (forecast == null) {
        return <div className="alert alert-info" style={{ marginBottom: '0' }}>No power usage currently forecast</div>;
    }

    const midnight = new Date(currentTime ?? new Date());
    midnight.setHours(0, 0, 0, 0);
    const windowStart = midnight.getTime() / 1000;

    const toPercent = (unixSeconds: number) => Math.min(100, Math.max(0, ((unixSeconds - windowStart) / WINDOW_SECONDS) * 100));

    const maxPower = Math.max(1, ...forecast.slots.map(slot => Math.abs(Number(slot.nominalPower))));

    let offset = forecast.startTime;

    const slots = forecast.slots.map((slot, index) => {
        const start = offset;
        offset += slot.defaultDuration;

        const power = Number(slot.nominalPower);
        const left = toPercent(start);
        const width = toPercent(start + slot.defaultDuration) - left;
        const height = Math.max(4, (Math.abs(power) / maxPower) * 100);

        const classes = ["forecastSlot"];
        if (power < 0) classes.push("generation");
        if (index === forecast.activeSlotNumber) classes.push("active");

        return <div
            key={`slot_${index}`}
            className={classes.join(" ")}
            style={{ left: `${left}%`, width: `calc(${width}% - 1px)`, height: `${height}%` }}
            title={`${formatTime(start)}–${formatTime(start + slot.defaultDuration)}: ${formatPower(power)}`}>
            {width > 4 && <span>{formatPower(power)}</span>}
        </div>;
    });

    // The window the device will accept a start time adjustment within.
    let startWindow = null;
    if (forecast.latestEndTime !== undefined && forecast.latestEndTime > forecast.endTime) {
        const earliest = forecast.earliestStartTime ?? Math.floor(Date.now() / 1000);
        const left = toPercent(earliest);
        startWindow = <div className="startWindow" style={{ left: `${left}%`, width: `${toPercent(forecast.latestEndTime) - left}%` }}
            title={`Can run between ${formatTime(earliest)} and ${formatTime(forecast.latestEndTime)}`} />;
    }

    const ticks = [];
    for (let hour = 0; hour <= WINDOW_HOURS; hour += 6) {
        ticks.push(<span key={`tick_${hour}`} className="tick" style={{ left: `${(hour / WINDOW_HOURS) * 100}%` }}>
            {String(hour % 24).padStart(2, '0')}:00
        </span>);
    }

    const energyKWh = forecast.slots.reduce((sum, slot) => sum + Number(slot.nominalPower) * slot.defaultDuration, 0) / 3.6e9; // mW·s to kWh

    return <div className="energyForecastContainer">
        <div className="forecastStrip">
            {startWindow}
            {slots}
            <div className="nowMarker" style={{ left: `${toPercent(Math.floor(Date.now() / 1000))}%` }} />
            <div className="midnightMarker" style={{ left: '50%' }} />
        </div>
        <div className="forecastTicks">{ticks}</div>
        <div className="forecastSummary">
            {formatTime(forecast.startTime)}–{formatTime(forecast.endTime)} · {energyKWh.toFixed(2)} kWh
            {forecast.forecastId !== undefined && <> · forecast #{forecast.forecastId}</>}
        </div>
    </div>;
}

export default ForecastTimeline;
