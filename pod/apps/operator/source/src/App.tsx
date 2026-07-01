import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { Today } from "./routes/Today";
import { Pipeline } from "./routes/Pipeline";
import { Compare } from "./routes/Compare";
import { Candidates } from "./routes/Candidates";
import { CandidateDetail } from "./routes/CandidateDetail";
import { Drafts } from "./routes/Drafts";
import { Roles } from "./routes/Roles";
import { Activity } from "./routes/Activity";
import { Demo } from "./routes/Demo";

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Today />} />
        <Route path="/pipeline" element={<Pipeline />} />
        <Route path="/compare" element={<Compare />} />
        <Route path="/candidates" element={<Candidates />} />
        <Route path="/candidates/:id" element={<CandidateDetail />} />
        <Route path="/drafts" element={<Drafts />} />
        <Route path="/roles" element={<Roles />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/demo" element={<Demo />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
