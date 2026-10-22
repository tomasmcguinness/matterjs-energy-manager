import { useEffect, useState } from "react";
import { Forecast } from "./device.ts";
import ForecastTimeline from "./forecastTimeline.tsx";
import { Manager } from "socket.io-client";
import { apiUrl } from './api.ts';

type DeviceViewProps = {
    nodeId: string;
    currentTime?: Date;
};

const DeviceView = ({ nodeId, currentTime }: DeviceViewProps) => {

    const [forecast, setForecast] = useState<Forecast | null>(null);

    useEffect(() => {

        const manager = new Manager(apiUrl(), {
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

        socket.on("forecast", (data: Forecast) => {
            console.log("Forecast Updated");

            if (data) {
                let forecast: Forecast = {
                    startTime: data.startTime,
                    endTime: data.endTime,
                    slots: [...data.slots]
                }
                setForecast(forecast);
            } else {
                setForecast(null);
            }
        });

        console.log('Fetching initial forecast data');

        fetch(`${apiUrl()}/devices/${nodeId}/forecast`).then(r => r.status === 200 ? r.json() : null).then(data => {

            if (data) {
                let forecast: Forecast = {
                    startTime: data.startTime,
                    endTime: data.endTime,
                    slots: [...data.slots]
                }
                setForecast(forecast);
            } else {
                setForecast(null);
            }
        });
    }, []);

    return <div>
        <ForecastTimeline forecast={forecast} currentTime={currentTime}  />
    </div>;
};

export default DeviceView;