'use client'

import { useEffect, useState } from 'react';
import Table from 'react-bootstrap/Table';
import Link from 'next/link'
import Badge from 'react-bootstrap/Badge';
import Container from 'react-bootstrap/Container';
import Alert from 'react-bootstrap/Alert';
import { NodeStates } from '@project-chip/matter.js/device';
import { Manager } from 'socket.io-client';
import Device from '../../device.ts';
import { apiUrl } from '../../api.ts';

export default function Page() {

  const [isLoading, setIsLoading] = useState(true);
  const [devices, setDevices] = useState<Device[]>([]);

  useEffect(() => {
    fetch(apiUrl('/devices')).then(r => r.json()).then(data => { setDevices(data); setIsLoading(false); });
  }, []);

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

    socket.on("power", (power: number) => {
      console.log("Power Update: " + power);
    });

    socket.on("status", (nodeId: number) => {
      console.log("Status Update: " + nodeId);
    });

    socket.on("forecast", (forecast: any) => {
      console.log("Forecast Updated: " + forecast.forecastId);
    });
  }, []);

  const [settingTimeSourceId, setSettingTimeSourceId] = useState<string | null>(null);
  const [timeSourceError, setTimeSourceError] = useState<string | null>(null);

  const handleRowClick = (device: Device) => {
    location.href = `/devices/${device.id}`;
  }

  const handleSetTimeSourceClick = async (event: React.MouseEvent, device: Device) => {

    // Don't open the device page.
    //
    event.stopPropagation();

    setSettingTimeSourceId(device.id);
    setTimeSourceError(null);

    try {
      const response = await fetch(apiUrl(`/devices/${device.id}/trusted-time-source`), { method: "POST" });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? `The request failed (${response.status})`);
      }

      setDevices(devices.map(d => d.id === device.id ? { ...d, usesEnergyManagerTime: true } : d));
    } catch (error: any) {
      setTimeSourceError(`Could not set the time source for ${device.id}: ${error.message}`);
    } finally {
      setSettingTimeSourceId(null);
    }
  }

  const getTimeSourceCell = (device: Device): any => {

    if (!device.supportsTrustedTimeSource) {
      return null;
    }

    if (device.usesEnergyManagerTime) {
      return <Badge bg="success">Energy Manager</Badge>;
    }

    const isSetting = settingTimeSourceId === device.id;

    return <button className="btn btn-sm btn-outline-primary text-nowrap" disabled={isSetting} onClick={(event) => handleSetTimeSourceClick(event, device)}>
      {isSetting ? 'Setting…' : 'Set trusted time source'}
    </button>;
  }

  const getStateBadge = (state: NodeStates): any => {
    var stateBadge: any = null;

    switch (state) {
      case NodeStates.Connected:
        stateBadge = <Badge bg="success">Connected</Badge>;
        break;
      case NodeStates.Disconnected:
        stateBadge = <Badge bg="success">Disconnected</Badge>;
        break;
      case NodeStates.Reconnecting:
        stateBadge = <Badge bg="success">Reconnecting</Badge>;
        break;
      case NodeStates.WaitingForDeviceDiscovery:
        stateBadge = <Badge bg="success">WaitingForDeviceDiscovery</Badge>;
        break;
    }

    return stateBadge;
  }

  const deviceTRs = devices.map((device) => {
    const deviceTypes = device.deviceTypes.map(dt => {

      var name = dt.toString();

      switch (dt) {
        case 777:
          name = "Heat Pump";
          break;
        case 1296:
          name = "Electrical Sensor";
          break;
        case 17:
          name = "Power Source";
          break;
        case 769:
          name = "Thermostat";
          break;
        case 770:
          name = "Temperature Sensor";
          break;
        case 1293:
          name = "Device Energy Manager";
          break;
        case 117:
          name = "Dishwasher";
          break;
        case 1299:
          name = "Electrical Energy Tariff";
          break;
      }

      return (<span key={dt} className="badge bg-primary" style={{ marginRight: '5px' }}>{name}</span>)
    });

    return (<tr key={device.id} style={{ cursor: 'pointer' }} onClick={() => handleRowClick(device)}><td>{device.id}</td><td>{deviceTypes}</td><td style={{ width: '1%' }}>{getTimeSourceCell(device)}</td><td style={{ width: '1%' }}>{getStateBadge(device.state)}</td></tr>)
  });

  var body = null;

  if (isLoading) {
    body = <Alert variant="info">Loading nodes...</Alert>;
  }
  else {
    if (deviceTRs.length == 0) {
      body = <Alert variant="info">No devices have been commissioned. We cannot use Bluetooth to commission a device, so open the Pairing Windows using another device.</Alert>
    } else {
      body = <Table striped bordered hover>
        <thead>
          <tr>
            <th>Node Id</th>
            <th>Devices</th>
            <th className="text-nowrap">Time Source</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {deviceTRs}
        </tbody>
      </Table>;
    }
  }

  return <Container>
    <h1>Devices</h1>
    <hr />
    {timeSourceError && <Alert variant="danger" onClose={() => setTimeSourceError(null)} dismissible>{timeSourceError}</Alert>}
    {body}
    <Link href="/devices/add" className="btn btn-primary">Add Device</Link>
  </Container>;
};