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
  const [autoOptimisation, setAutoOptimisation] = useState<boolean | null>(null);

  const [devices, setDevices] = useState<any[]>([]);

  useEffect(() => {
    fetch(apiUrl('/prices')).then(r => r.json()).then(data => { setPrices(data); });
    fetch(apiUrl('/devices')).then(r => r.json()).then(data => { setDevices(data); });
    fetch(apiUrl('/auto-optimisation')).then(r => r.json()).then(data => { setAutoOptimisation(data.enabled); });

    // The pricing server publishes new prices as they change.
    //
    const manager = new Manager(apiUrl(), {
      reconnectionDelayMax: 10000,
    });

    const socket = manager.socket("/");

    socket.on("prices", (data: Prices) => setPrices(data));
    socket.on("autoOptimisation", (enabled: boolean) => setAutoOptimisation(enabled));

    setCurrentTime(new Date())

    // Keep the "now" markers moving.
    //
    const timer = setInterval(() => setCurrentTime(new Date()), 60 * 1000);

    return () => {
      clearInterval(timer);
      manager.engine?.close();
    };
  }, []);

  const hasPrices = prices != null && prices.periods.length > 0;

  const handleAutoOptimisationChange = async (enabled: boolean) => {
    setAutoOptimisation(enabled);

    const response = await fetch(apiUrl('/auto-optimisation'), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }).catch(() => null);

    // Put the switch back if the change wasn't saved.
    //
    if (!response?.ok) {
      setAutoOptimisation(!enabled);
    }
  };

  const handleOptimiseClick = () => {
    setIsOptimising(true);
    fetch(`${apiUrl()}/optimise`, { method: "POST" }).then(() => setIsOptimising(false));
  };

  // Only devices with Device Energy Management forecast their power usage,
  // so leave out the rest, such as the pricing server.
  //
  const DEVICE_ENERGY_MANAGEMENT = 1293;

  var deviceCards = devices.filter(device => device.deviceTypes.includes(DEVICE_ENERGY_MANAGEMENT)).map((device, index) => {

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

      {/* Optimising needs prices to compare start times against. While
          it's automatic, there's no need to optimise by hand. */}
      {hasPrices && <div className="d-flex align-items-center gap-3">
        <div className="form-check form-switch mb-0">
          <input className="form-check-input" type="checkbox" role="switch" id="auto-optimisation"
            checked={autoOptimisation === true}
            disabled={autoOptimisation === null}
            onChange={(event) => handleAutoOptimisationChange(event.target.checked)} />
          <label className="form-check-label" htmlFor="auto-optimisation">Auto-Optimisation</label>
        </div>
        <button className="btn btn-primary" onClick={handleOptimiseClick} disabled={autoOptimisation !== false || isOptimising}>Optimise</button>
      </div>}

    </div>
  </div>;
};