'use client'

import TariffTimeline from '../../tariffTimeline.tsx';
import { useEffect, useState } from 'react';
import DeviceView from '../../deviceView.tsx';
import Device, { DemEndpoint } from '../../device.ts';
import { esaTypeNames, optOutStateNames } from '../../names.ts';
import { Manager } from 'socket.io-client';

type OptimisationResult = {
  nodeId: string;
  endpointId: number;
  action: "moved" | "unchanged" | "skipped" | "failed";
  reason?: string;
  from?: number;
  startTime?: number;
  previousCost?: number;
  cost?: number;
};

const formatTime = (unixSeconds?: number) =>
  unixSeconds ? new Date(unixSeconds * 1000).toLocaleTimeString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '–';

export default function Page() {

  const [currentTime, setCurrentTime] = useState<Date>(new Date());

  const [isOptimising, setIsOptimising] = useState<boolean>(false);
  const [optimisationResults, setOptimisationResults] = useState<OptimisationResult[] | null>(null);
  const [prices, setPrices] = useState<number[]>([]);

  const [devices, setDevices] = useState<Device[]>([]);
  const [endpoints, setEndpoints] = useState<DemEndpoint[]>([]);

  useEffect(() => {
    fetch('http://localhost:4000/tariff').then(r => r.json()).then(data => { setPrices(data); });
    fetch('http://localhost:4000/devices').then(r => r.json()).then(data => { setDevices(data); });
    fetch('http://localhost:4000/energy/devices').then(r => r.json()).then(data => { setEndpoints(data); });

    setCurrentTime(new Date())
  }, []);

  useEffect(() => {
    const manager = new Manager("http://localhost:4000", {
      reconnectionDelayMax: 10000,
    });

    const socket = manager.socket("/");

    // Endpoints are discovered as nodes connect; add or refresh them as they arrive.
    socket.on("demEndpoint", (endpoint: DemEndpoint) => {
      setEndpoints(current => [
        ...current.filter(e => e.nodeId !== endpoint.nodeId || e.endpointId !== endpoint.endpointId),
        endpoint,
      ]);
    });

    socket.on("optOutState", ({ nodeId, endpointId, value }: { nodeId: string, endpointId: number, value: number }) => {
      setEndpoints(current => current.map(e => e.nodeId === nodeId && e.endpointId === endpointId ? { ...e, optOutState: value } : e));
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const handleOptimiseClick = () => {
    setIsOptimising(true);
    setOptimisationResults(null);
    fetch(`http://localhost:4000/optimise`, { method: "POST" })
      .then(r => r.json())
      .then(results => setOptimisationResults(results))
      .finally(() => setIsOptimising(false));
  };

  const deviceName = (nodeId: string) => devices.find(d => d.id === nodeId)?.productName ?? `Node ${nodeId}`;

  const sortedEndpoints = [...endpoints].sort((a, b) => Number(a.nodeId) - Number(b.nodeId) || a.endpointId - b.endpointId);

  var deviceCards = sortedEndpoints.map((endpoint) => {

    const optOut = endpoint.optOutState === undefined ? null
      : <span className={`badge ${endpoint.optOutState === 0 ? 'text-bg-success' : 'text-bg-danger'}`} style={{ marginLeft: '5px' }}>{optOutStateNames[endpoint.optOutState]}</span>;

    return (<div key={`dem_${endpoint.nodeId}_${endpoint.endpointId}`} className="card" style={{ marginBottom: '10px' }}>
        <div className="card-header">
          {deviceName(endpoint.nodeId)} <small className="text-body-secondary">node {endpoint.nodeId} · endpoint {endpoint.endpointId}</small>
          <span className="badge text-bg-secondary" style={{ marginLeft: '5px' }}>{esaTypeNames[endpoint.esaType] ?? `ESA ${endpoint.esaType}`}</span>
          {endpoint.features?.startTimeAdjustment && <span className="badge text-bg-primary" style={{ marginLeft: '5px' }}>Start time adjustable</span>}
          {endpoint.esaCanGenerate && <span className="badge text-bg-info" style={{ marginLeft: '5px' }}>Can generate</span>}
          {optOut}
        </div>
        <div className="card-body">
          <DeviceView nodeId={endpoint.nodeId} endpointId={endpoint.endpointId} initialForecast={endpoint.forecast} currentTime={currentTime} />
        </div>
      </div>);
  });

  const resultRows = optimisationResults?.map(result => {
    let outcome = result.reason ?? result.action;
    if (result.action === "moved") {
      outcome = `Moved ${formatTime(result.from)} → ${formatTime(result.startTime)}, ${result.previousCost?.toFixed(1)}p → ${result.cost?.toFixed(1)}p`;
    } else if (result.action === "unchanged") {
      outcome = `Already at the cheapest start (${formatTime(result.startTime)}, ${result.cost?.toFixed(1)}p)`;
    }
    return <tr key={`result_${result.nodeId}_${result.endpointId}`}>
      <td>{deviceName(result.nodeId)}</td>
      <td>{result.endpointId}</td>
      <td>{outcome}</td>
    </tr>;
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
          <TariffTimeline prices={prices} currentTime={currentTime} />
        </div>
      </div>

      {deviceCards.length === 0 && <div className="alert alert-info">No devices with Device Energy Management have been found.</div>}

      {deviceCards}

      {isOptimising && <div className="alert alert-info">
        Optimising Energy Usage
      </div>}

      {resultRows && <table className="table table-sm">
        <thead><tr><th>Device</th><th>Endpoint</th><th>Result</th></tr></thead>
        <tbody>{resultRows}</tbody>
      </table>}

      <button className="btn btn-primary" onClick={handleOptimiseClick} disabled={isOptimising}>Optimise</button>

    </div>
  </div>;
};
