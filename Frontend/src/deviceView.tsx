import { useEffect, useState } from "react";
import { Forecast } from "./device.ts";
import ForecastTimeline from "./forecastTimeline.tsx";
import { Manager } from "socket.io-client";

type DeviceViewProps = {
    nodeId: string;
    endpointId: number;
    initialForecast?: Forecast | null;
    currentTime?: Date;
};

type ForecastUpdate = {
    nodeId: string;
    endpointId: number;
    forecast: Forecast | null;
};

const DeviceView = ({ nodeId, endpointId, initialForecast, currentTime }: DeviceViewProps) => {

    const [forecast, setForecast] = useState<Forecast | null>(initialForecast ?? null);

    useEffect(() => {

        const manager = new Manager("http://localhost:4000", {
            reconnectionDelayMax: 10000,
        });

        const socket = manager.socket("/");

        manager.open((err: any) => {
            if (err) {
                // an error has occurred
            } else {
                // the connection was successfully established
                console.log("Socket connection established");
            }
        });

        socket.on("forecast", (update: ForecastUpdate) => {
            if (update.nodeId !== nodeId || update.endpointId !== endpointId) {
                return;
            }

            console.log(`Forecast Updated for ${nodeId}/${endpointId}`);

            setForecast(update.forecast ? { ...update.forecast, slots: [...update.forecast.slots] } : null);
        });

        console.log('Fetching initial forecast data');

        fetch(`http://localhost:4000/devices/${nodeId}/endpoints/${endpointId}/forecast`).then(r => r.status === 200 ? r.json() : null).then(data => {
            setForecast(data ? { ...data, slots: [...data.slots] } : null);
        });

        return () => {
            socket.disconnect();
        };
    }, [nodeId, endpointId]);

    return <div>
        <ForecastTimeline forecast={forecast} currentTime={currentTime} />
    </div>;
};

export default DeviceView;
