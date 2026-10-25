'use client'

import Link from 'next/link.js';
import { use, useState, useEffect } from 'react';
import { Button, Container } from 'react-bootstrap';
import { Manager } from 'socket.io-client';
import { esaTypeNames, optOutStateNames } from '../../../names.ts';

// export default function Page({
//   params,
// }: {
//   params: Promise<{ deviceId: string }>
// }) {

export default function Page({ params }) {

  let self = this;

  const { deviceId } = use(params);

  const [device, setDevice] = useState(null);
  const [energyEndpoints, setEnergyEndpoints] = useState([]);

  useEffect(() => {
    fetch(`http://localhost:4000/devices/${deviceId}`).then(r => r.json()).then(data => { setDevice(data); });
    fetch(`http://localhost:4000/devices/${deviceId}/energy`).then(r => r.json()).then(data => { setEnergyEndpoints(data); });
  }, []);

  useEffect(() => {

    const manager = new Manager("http://localhost:4000", {
      reconnectionDelayMax: 10000,
    });

    const socket = manager.socket("/");

    manager.open(err => {
      if (err) {
        // an error has occurred
      } else {
        // the connection was successfully established
        console.log("Socket connection established");
      }
    });

    socket.on("optOutState", ({ nodeId, endpointId, value }) => {
      console.log(`Opt Out State Update: ${nodeId}/${endpointId} ${value}`);
      if (nodeId === deviceId) {
        setEnergyEndpoints(current => current.map(e => e.endpointId === endpointId ? { ...e, optOutState: value } : e));
      }
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const unpairDevice = () => {
    let unpair = confirm("Are you sure you want to unpair this device?");

    if (unpair) {
      fetch(`http://localhost:4000/devices/${deviceId}`, { method: "DELETE" });
    }
  };

  const optOutBadge = (optOutState) => {
    if (optOutState === undefined) {
      return <span className="badge text-bg-secondary">Forecast only</span>;
    }
    return <span className={`badge ${optOutState === 0 ? 'text-bg-success' : 'text-bg-danger'}`}>{optOutStateNames[optOutState]}</span>;
  };

  const energyRows = energyEndpoints.map(endpoint => (
    <tr key={endpoint.endpointId}>
      <td>{endpoint.endpointId}</td>
      <td>{esaTypeNames[endpoint.esaType] ?? endpoint.esaType}</td>
      <td>{Object.entries(endpoint.features ?? {}).filter(([, on]) => on).map(([name]) => name).join(', ')}</td>
      <td>{optOutBadge(endpoint.optOutState)}</td>
    </tr>
  ));

  return <Container>
    <h1>{device?.productName ?? deviceId} <small className="text-body-secondary">node {deviceId}</small></h1>
    <hr />
    <h3>Device Energy Management</h3>
    {energyRows.length === 0
      ? <div className="alert alert-info">This device has no Device Energy Management endpoints.</div>
      : <table className="table">
        <thead><tr><th>Endpoint</th><th>ESA type</th><th>Features</th><th>Opt out</th></tr></thead>
        <tbody>{energyRows}</tbody>
      </table>}
    <Link href="/devices" className="btn btn-secondary" style={{ marginRight: '5px' }}>Back to Devices</Link>
    <Button onClick={unpairDevice}>Unpair Device</Button>
  </Container>;
};