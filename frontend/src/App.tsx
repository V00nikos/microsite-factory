import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { FleetBoard } from "./screens/FleetBoard";
import { Intake } from "./screens/Intake";
import { Preview, PreviewIndex } from "./screens/Preview";
import { GtmPlanner } from "./screens/GtmPlanner";

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <FleetBoard /> },
      { path: "/intake", element: <Intake /> },
      { path: "/preview", element: <PreviewIndex /> },
      { path: "/preview/:accountId", element: <Preview /> },
      { path: "/brief", element: <GtmPlanner /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
