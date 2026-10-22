// Shared time axis for the energy charts, so the tariff and device forecasts
// line up. All times are milliseconds since the Unix epoch.
//
export const HOUR_MS = 60 * 60 * 1000;

export const Y_AXIS_WIDTH = 60;

export const dayDomain = (date: Date = new Date()): [number, number] => {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);

    return [start.getTime(), start.getTime() + 24 * HOUR_MS];
};

export const dayTicks = (date: Date = new Date(), everyHours: number = 3): number[] => {
    const [start] = dayDomain(date);

    const ticks = [];

    for (let hour = 0; hour <= 24; hour += everyHours) {
        ticks.push(start + hour * HOUR_MS);
    }

    return ticks;
};

export const formatTime = (time: number): string => {
    const date = new Date(time);
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
};
