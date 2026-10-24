'use client'

import PriceTimeline, { Prices } from '../../priceTimeline.tsx';
import { useEffect, useState } from 'react';
import { Manager } from 'socket.io-client';
import DeviceView from '../../deviceView.tsx';
import { apiUrl } from '../../api.ts';

export default function Page() {

  const [currentTime, setCurrentTime] = useState<Date>(new Date());

  const [isOptimising, setIsOptimising] = useState<boolean>(false);
  const [prices, setPrices] = useState<Prices | null>(null);

  const [devices, setDevices] = useState<any[]>([]);

  useEffect(() => {
    fetch(apiUrl('/prices')).then(r => r.json()).then(data => { setPrices(data); });
    fetch(apiUrl('/devices')).then(r => r.json()).then(data => { setDevices(data); });

    // The pricing server publishes new prices as they change.
    //
    const manager = new Manager(apiUrl(), {
      reconnectionDelayMax: 10000,
    });

    manager.socket("/").on("prices", (data: Prices) => setPrices(data));

    setCurrentTime(new Date())

    // Keep the "now" markers moving.
    //
    const timer = setInterval(() => setCurrentTime(new Date()), 60 * 1000);

    return () => {
      clearInterval(timer);
      manager.engine?.close();
    };
  }, []);

  const handleOptimiseClick = () => {
    setIsOptimising(true);
    fetch(`${apiUrl()}/optimise`, { method: "POST" }).then(() => setIsOptimising(false));
  };

  var deviceCards = devices.map((device, index) => {

    return (<div key={`device_${index}`} className="card" style={{ marginBottom: '10px' }}>
        <div className="card-header">
          {device.id} {device.optOutState}
        </div>
        <div className="card-body">
          <DeviceView nodeId={device.id} currentTime={currentTime} />
        </div>
      </div>);
  });

  return <div>
    <h1>Energy Forecast</h1>
    <hr />
    <div style={{ position: 'relative' }} suppressHydrationWarning={true}>

      <div className="card" style={{ marginBottom: '10px' }}>
        <div className="card-header">
          Electricity Price
        </div>
        <div className="card-body">
          <PriceTimeline prices={prices} currentTime={currentTime} />
        </div>
      </div>

      {deviceCards}

      {isOptimising && <div className="alert alert-info">
        Optimising Energy Usage
      </div>}

      <button className="btn btn-primary" onClick={handleOptimiseClick}>Optimise</button>

    </div>
  </div>;
};