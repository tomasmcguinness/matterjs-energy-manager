import Container from 'react-bootstrap/Container';
import Nav from 'react-bootstrap/Nav';
import Navbar from 'react-bootstrap/Navbar';
import NavbarBrand from 'react-bootstrap/NavbarBrand';
import NavLink from 'react-bootstrap/NavLink';
// import Alert from 'react-bootstrap/Alert';
import '../app/global.css';
import { useEffect } from 'react';

export default function RootLayout({ children }: { children: React.ReactNode }) {

  return (
    <html lang="en">
      <head>
        <title>MatterJS Energy Manager</title>
      </head>
      <body>
        <Navbar bg="dark" data-bs-theme="dark">
          <Container>
            <NavbarBrand href="/">Energy Manager</NavbarBrand>
            <Nav className="me-auto">
              <NavLink href="/">Home</NavLink>
              <NavLink href="/energy">Energy</NavLink>
              <NavLink href="/devices">Devices</NavLink>
            </Nav>
          </Container>
        </Navbar>
        {/* <Container> */}
          {/* <Alert variant={'primary'}>
            Energy usage is being optimized....
          </Alert> */}
          <div style={{ padding: '25px' }}>
            {children}
          </div>
        {/* </Container> */}
      </body>
    </html>
  )
}