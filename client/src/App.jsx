import { Navigate, Route, Routes } from 'react-router-dom';
import Profile from './pages/Profile.jsx';
import Home from './pages/Home.jsx';
import Landing from './pages/Landing.jsx';
import HostStub from './pages/HostStub.jsx';
import JoinStub from './pages/JoinStub.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/profile" element={<Profile />} />
      <Route path="/" element={<Landing />} />
      <Route path="/home" element={<Home />} />
      <Route path="/host/:code" element={<HostStub />} />
      <Route path="/join" element={<JoinStub />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
