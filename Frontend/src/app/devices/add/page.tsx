'use client'
import Link from 'next/link';
import { useState } from 'react';
import { Container } from 'react-bootstrap';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import { apiUrl } from '../../../api.ts';

const SocketComponent = () => {

  const [manualSetupCode, setManualSetupCode] = useState('');

  function performBasicCommissioning(e: any) {
    e.preventDefault();

    var body = JSON.stringify({
      manualSetupCode,
    });

    fetch(apiUrl('/devices'), {
      headers: {
        "Content-Type": "application/json",
      },
      method: 'POST', body
    });
  }

  return <Container>
    <h1>Add Node</h1>
    <hr />
    <Form>
      <Form.Group className="mb-3" controlId="exampleForm.ControlInput1">
        <Form.Label>Manual Pairing Code</Form.Label>
        <Form.Control type="text" placeholder="1234-123-1234" value={manualSetupCode} onChange={(e: any) => setManualSetupCode(e.target.value)} />
      </Form.Group>
    </Form>
    <Link href="/devices" className="btn btn-danger" style={{marginRight:'5px'}}>Cancel</Link>
    <Button onClick={performBasicCommissioning}>Commission</Button>
  </Container>;
};

export default SocketComponent;