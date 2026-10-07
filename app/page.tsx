import Portal from './portal';
import {AdminGate} from './admin-login';
import './admin-auth.css';
import './admin-shell.css';
/** The administrator portal is the home page: the sign-in page until a session exists, then the portal. The resident app is served at /app. */
export default function Home(){return <AdminGate><Portal/></AdminGate>;}
