'use client'

import Link from 'next/link.js';
import { use, useState, useEffect, useRef } from 'react';
import { Button, Container } from 'react-bootstrap';
import { Manager } from 'socket.io-client';
import { apiUrl } from '../../../api.ts';

// export default function Page({
//   params,
// }: {
//   params: Promise<{ deviceId: string }>
// }) {

export default function Page({ params }) {

  let self = this;

  const { deviceId } = use(params);

  const [device, setDevice] = useState(null);
  const deviceRef = useRef(device);

  useEffect(() => {
    fetch(`${apiUrl()}/devices/${deviceId}`).then(r => r.json()).then(data => { setDevice(data); deviceRef.current = data; });
  }, []);

  useEffect(() => {

    const manager = new Manager(apiUrl(), {
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

    socket.on("optOutState", (state) => {
      console.log("Opt Out State Update: " + state);
      console.log(deviceRef.current);
      if(deviceRef.current) {
        deviceRef.current.optOut = state;
        setDevice({ ...deviceRef.current });
      }
    });
  }, []);

  const unpairDevice = () => {
    let unpair = confirm("Are you sure you want to unpair this device?");

    if (unpair) {
      fetch(`${apiUrl()}/devices/${deviceId}`, { method: "DELETE" });
    }
  };

  let optOutStatus = <></>;

  if (device) {
    if (device.optOut === 3) {
      optOutStatus = <span className="badge text-bg-danger">Opted Out</span>
    } else if (device.optOut === 0) {
      optOutStatus = <span className="badge text-bg-success">Opted In</span>
    }
  }

  return <Container>
    <h1>{deviceId}</h1>
    <hr />
    <h3>Device Energy Management : {optOutStatus}</h3>
    <Link href="/devices" className="btn btn-secondary" style={{ marginRight: '5px' }}>Back to Devices</Link>
    <Button onClick={unpairDevice}>Unpair Device</Button>
  </Container>;
};