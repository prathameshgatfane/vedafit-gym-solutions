import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { BrowserRouter } from "react-router-dom";
import { AppRoutes } from "./app/router";
import { createQueryClient } from "./app/query-client";
import { useSessionBootstrap } from "./features/auth/useSessionBootstrap";

function SessionBootstrap() {
  useSessionBootstrap();
  return null;
}

function App() {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SessionBootstrap />
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
